import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { normalizeApiBaseUrl } from "./url.ts";

const AUTHORIZATION_WINDOW_MS = 5 * 60 * 1_000;
const CLEANUP_GRACE_MS = 60 * 1_000;

export const LOGIN_LOCK_STALE_AFTER_MS = AUTHORIZATION_WINDOW_MS + CLEANUP_GRACE_MS;

const METADATA_FILE = "owner.json";

type LoginLockMetadata = {
  version: 1;
  ownerId: string;
  pid: number;
  createdAt: number;
  expiresAt: number;
};

export interface LoginLock {
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}

export type AcquireLoginLock = (baseUrl: string) => Promise<LoginLock>;

export class LoginAlreadyInProgressError extends Error {
  constructor(retryAfterMs: number) {
    const retrySeconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
    super(
      `Another DM Faster browser login is already in progress for this API origin. `
      + `Finish it, or retry in about ${retrySeconds} seconds if it was interrupted.`,
    );
    this.name = "LoginAlreadyInProgressError";
  }
}

export class LoginLockUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LoginLockUnavailableError";
  }
}

export class LoginLockLostError extends Error {
  constructor() {
    super(
      "The DM Faster browser-login lock expired or was recovered by another process. "
      + "The new credential was not saved; run `dmfaster auth login` again.",
    );
    this.name = "LoginLockLostError";
  }
}

function defaultRoot(input: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homeDirectory: string;
}) {
  if (input.platform === "darwin") {
    return join(input.homeDirectory, "Library", "Caches", "DM Faster", "auth-locks");
  }
  if (input.platform === "linux") {
    const runtimeDirectory = input.env.XDG_RUNTIME_DIR?.trim();
    if (runtimeDirectory && isAbsolute(runtimeDirectory)) {
      return join(runtimeDirectory, "dmfaster", "auth-locks");
    }
    return join(input.homeDirectory, ".cache", "dmfaster", "auth-locks");
  }
  throw new LoginLockUnavailableError(
    `Cross-process DM Faster browser-login locking is not supported on ${input.platform}.`,
  );
}

async function ensurePrivateRoot(root: string) {
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const details = await lstat(root);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error("lock root is not a private directory");
    }
    if (typeof process.getuid === "function" && details.uid !== process.getuid()) {
      throw new Error("lock root is owned by another user");
    }
    if ((details.mode & 0o077) !== 0) await chmod(root, 0o700);
  } catch (cause) {
    if (cause instanceof LoginLockUnavailableError) throw cause;
    throw new LoginLockUnavailableError(
      "DM Faster could not create a private browser-login lock. Check local cache-directory permissions and try again.",
      { cause },
    );
  }
}

function parseMetadata(value: string): LoginLockMetadata | null {
  try {
    const parsed = JSON.parse(value) as Partial<LoginLockMetadata>;
    if (
      parsed.version !== 1
      || typeof parsed.ownerId !== "string"
      || !/^[a-zA-Z0-9_-]{8,160}$/.test(parsed.ownerId)
      || !Number.isInteger(parsed.pid)
      || Number(parsed.pid) < 1
      || !Number.isFinite(parsed.createdAt)
      || !Number.isFinite(parsed.expiresAt)
      || Number(parsed.expiresAt) <= Number(parsed.createdAt)
    ) return null;
    return parsed as LoginLockMetadata;
  } catch {
    return null;
  }
}

async function readExistingLock(input: {
  lockPath: string;
  now: number;
}): Promise<{ stale: boolean; retryAfterMs: number }> {
  let metadata: LoginLockMetadata | null = null;
  try {
    metadata = parseMetadata(await readFile(join(input.lockPath, METADATA_FILE), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (metadata) {
    return {
      stale: input.now >= metadata.expiresAt,
      retryAfterMs: Math.max(0, metadata.expiresAt - input.now),
    };
  }

  const details = await stat(input.lockPath);
  const fallbackExpiresAt = details.mtimeMs + LOGIN_LOCK_STALE_AFTER_MS;
  return {
    stale: input.now >= fallbackExpiresAt,
    retryAfterMs: Math.max(0, fallbackExpiresAt - input.now),
  };
}

async function moveStaleLock(input: {
  root: string;
  lockPath: string;
  lockName: string;
  ownerId: string;
}) {
  const quarantine = join(input.root, `${input.lockName}.stale-${input.ownerId}`);
  try {
    await rename(input.lockPath, quarantine);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EEXIST") return false;
    throw error;
  }
  await rm(quarantine, { recursive: true, force: true });
  return true;
}

export async function acquireLoginLock(input: {
  baseUrl: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  rootDirectory?: string;
  now?: () => number;
  pid?: number;
  ownerId?: string;
}): Promise<LoginLock> {
  const platform = input.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    throw new LoginLockUnavailableError(
      `Cross-process DM Faster browser-login locking is not supported on ${platform}.`,
    );
  }

  const now = input.now ?? Date.now;
  const createdAt = now();
  const pid = input.pid ?? process.pid;
  const ownerId = input.ownerId ?? `${pid}-${createdAt}-${randomBytes(8).toString("hex")}`;
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(ownerId) || !Number.isInteger(pid) || pid < 1) {
    throw new LoginLockUnavailableError("DM Faster could not create valid browser-login lock ownership metadata.");
  }

  const baseUrl = normalizeApiBaseUrl(input.baseUrl);
  const originHash = createHash("sha256").update(baseUrl).digest("hex");
  const lockName = `${originHash}.lock`;
  const root = input.rootDirectory ?? defaultRoot({
    platform,
    env: input.env ?? process.env,
    homeDirectory: input.homeDirectory ?? homedir(),
  });
  if (!isAbsolute(root)) {
    throw new LoginLockUnavailableError("DM Faster browser-login lock directory must be absolute.");
  }
  await ensurePrivateRoot(root);
  const lockPath = join(root, lockName);
  const metadata: LoginLockMetadata = {
    version: 1,
    ownerId,
    pid,
    createdAt,
    expiresAt: createdAt + LOGIN_LOCK_STALE_AFTER_MS,
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await writeFile(join(lockPath, METADATA_FILE), JSON.stringify(metadata), {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
      } catch (cause) {
        await rm(lockPath, { recursive: true, force: true });
        throw new LoginLockUnavailableError(
          "DM Faster could not initialize the browser-login lock.",
          { cause },
        );
      }

      let released = false;
      const assertOwned = async () => {
        if (released || now() >= metadata.expiresAt) throw new LoginLockLostError();
        let current: LoginLockMetadata | null = null;
        try {
          current = parseMetadata(await readFile(join(lockPath, METADATA_FILE), "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new LoginLockLostError();
          throw new LoginLockUnavailableError(
            "DM Faster could not verify browser-login lock ownership.",
            { cause: error },
          );
        }
        if (current?.ownerId !== ownerId) throw new LoginLockLostError();
      };
      return {
        assertOwned,
        async release() {
          if (released) return;
          released = true;
          // Once this lease is stale, a newer process may own the same path.
          // Never touch it; stale-lock recovery will remove our old directory.
          if (now() >= metadata.expiresAt) return;
          let current: LoginLockMetadata | null = null;
          try {
            current = parseMetadata(await readFile(join(lockPath, METADATA_FILE), "utf8"));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
          }
          if (current?.ownerId !== ownerId) return;
          await rm(lockPath, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        if (error instanceof LoginLockUnavailableError) throw error;
        throw new LoginLockUnavailableError(
          "DM Faster could not acquire the private browser-login lock.",
          { cause: error },
        );
      }
    }

    let existing;
    try {
      existing = await readExistingLock({ lockPath, now: now() });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new LoginLockUnavailableError(
        "DM Faster could not inspect the existing browser-login lock.",
        { cause: error },
      );
    }
    if (!existing.stale) throw new LoginAlreadyInProgressError(existing.retryAfterMs);
    try {
      await moveStaleLock({ root, lockPath, lockName, ownerId });
    } catch (cause) {
      throw new LoginLockUnavailableError(
        "DM Faster could not recover an expired browser-login lock. Check local cache-directory permissions.",
        { cause },
      );
    }
  }

  throw new LoginAlreadyInProgressError(LOGIN_LOCK_STALE_AFTER_MS);
}
