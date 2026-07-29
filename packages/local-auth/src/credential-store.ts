import type { RunProcess } from "./process.ts";
import { runProcess } from "./process.ts";
import { normalizeApiBaseUrl } from "./url.ts";

const SERVICE = "com.dmfaster.agent";
const LABEL = "DM Faster agent access";

export type CredentialStoreKind = "macos-keychain" | "linux-secret-service" | "unsupported";

export interface CredentialStore {
  readonly kind: CredentialStoreKind;
  get(baseUrl: string): Promise<string | null>;
  set(baseUrl: string, token: string): Promise<void>;
  delete(baseUrl: string): Promise<void>;
}

export class CredentialStoreUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialStoreUnavailableError";
  }
}

function actionableUnavailable(platform: NodeJS.Platform) {
  const platformDetail = platform === "win32"
    ? "Windows Credential Manager integration is not available in this preview."
    : platform === "linux"
      ? "Install `secret-tool` and unlock a Secret Service keyring."
      : `Secure credential storage is not supported on ${platform}.`;
  return `${platformDetail} Set DMFASTER_TOKEN for this process or headless CI; DM Faster will not use a plaintext fallback.`;
}

export function normalizeAgentAccessToken(value: string) {
  const normalized = value.trim();
  if (!/^dmf_pat_[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("DM Faster returned an invalid access token.");
  }
  return normalized;
}

function isMissingExecutable(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function securityInteractiveValue(value: string) {
  if (/[\r\n\0]/.test(value)) {
    throw new Error("DM Faster Keychain metadata contains unsupported characters.");
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

class MacOsKeychainStore implements CredentialStore {
  readonly kind = "macos-keychain" as const;
  private readonly run: RunProcess;

  constructor(run: RunProcess) {
    this.run = run;
  }

  async get(baseUrl: string) {
    const account = normalizeApiBaseUrl(baseUrl);
    let result;
    try {
      result = await this.run("/usr/bin/security", [
        "find-generic-password",
        "-a",
        account,
        "-s",
        SERVICE,
        "-w",
      ]);
    } catch (cause) {
      throw new CredentialStoreUnavailableError(actionableUnavailable("darwin"), { cause });
    }
    if (result.exitCode === 44) return null;
    if (result.exitCode !== 0) {
      throw new CredentialStoreUnavailableError(actionableUnavailable("darwin"));
    }
    return normalizeAgentAccessToken(result.stdout);
  }

  async set(baseUrl: string, token: string) {
    const account = normalizeApiBaseUrl(baseUrl);
    const value = normalizeAgentAccessToken(token);
    let result;
    try {
      // Interactive mode receives the whole add command through stdin. Only
      // `security -i` is visible in argv, so the credential never enters the
      // process list. PAT characters need no interactive-shell quoting.
      const command = [
        "add-generic-password",
        "-U",
        "-a",
        securityInteractiveValue(account),
        "-s",
        securityInteractiveValue(SERVICE),
        "-l",
        securityInteractiveValue(LABEL),
        "-w",
        value,
      ].join(" ");
      result = await this.run("/usr/bin/security", ["-i"], { stdin: `${command}\n` });
    } catch (cause) {
      throw new CredentialStoreUnavailableError(actionableUnavailable("darwin"), { cause });
    }
    if (result.exitCode !== 0) {
      throw new CredentialStoreUnavailableError(actionableUnavailable("darwin"));
    }
  }

  async delete(baseUrl: string) {
    const account = normalizeApiBaseUrl(baseUrl);
    let result;
    try {
      result = await this.run("/usr/bin/security", [
        "delete-generic-password",
        "-a",
        account,
        "-s",
        SERVICE,
      ]);
    } catch (cause) {
      throw new CredentialStoreUnavailableError(actionableUnavailable("darwin"), { cause });
    }
    if (result.exitCode !== 0 && result.exitCode !== 44) {
      throw new CredentialStoreUnavailableError(actionableUnavailable("darwin"));
    }
  }
}

class LinuxSecretServiceStore implements CredentialStore {
  readonly kind = "linux-secret-service" as const;
  private readonly run: RunProcess;

  constructor(run: RunProcess) {
    this.run = run;
  }

  async get(baseUrl: string) {
    const account = normalizeApiBaseUrl(baseUrl);
    let result;
    try {
      result = await this.run("secret-tool", ["lookup", "service", SERVICE, "account", account]);
    } catch (cause) {
      if (isMissingExecutable(cause)) {
        throw new CredentialStoreUnavailableError(actionableUnavailable("linux"), { cause });
      }
      throw new CredentialStoreUnavailableError(actionableUnavailable("linux"), { cause });
    }
    if (result.exitCode === 1 && !result.stdout.trim() && !result.stderr.trim()) return null;
    if (result.exitCode !== 0) {
      throw new CredentialStoreUnavailableError(actionableUnavailable("linux"));
    }
    return normalizeAgentAccessToken(result.stdout);
  }

  async set(baseUrl: string, token: string) {
    const account = normalizeApiBaseUrl(baseUrl);
    const value = normalizeAgentAccessToken(token);
    let result;
    try {
      result = await this.run("secret-tool", [
        "store",
        `--label=${LABEL}`,
        "service",
        SERVICE,
        "account",
        account,
      ], { stdin: `${value}\n` });
    } catch (cause) {
      throw new CredentialStoreUnavailableError(actionableUnavailable("linux"), { cause });
    }
    if (result.exitCode !== 0) {
      throw new CredentialStoreUnavailableError(actionableUnavailable("linux"));
    }
  }

  async delete(baseUrl: string) {
    const account = normalizeApiBaseUrl(baseUrl);
    let result;
    try {
      result = await this.run("secret-tool", ["clear", "service", SERVICE, "account", account]);
    } catch (cause) {
      throw new CredentialStoreUnavailableError(actionableUnavailable("linux"), { cause });
    }
    if (result.exitCode !== 0) {
      throw new CredentialStoreUnavailableError(actionableUnavailable("linux"));
    }
  }
}

class UnsupportedCredentialStore implements CredentialStore {
  readonly kind = "unsupported" as const;
  private readonly platform: NodeJS.Platform;

  constructor(platform: NodeJS.Platform) {
    this.platform = platform;
  }

  async get(): Promise<null> {
    throw new CredentialStoreUnavailableError(actionableUnavailable(this.platform));
  }

  async set(): Promise<void> {
    throw new CredentialStoreUnavailableError(actionableUnavailable(this.platform));
  }

  async delete(): Promise<void> {
    throw new CredentialStoreUnavailableError(actionableUnavailable(this.platform));
  }
}

export function createSystemCredentialStore(input: {
  platform?: NodeJS.Platform;
  runProcess?: RunProcess;
} = {}): CredentialStore {
  const platform = input.platform ?? process.platform;
  const run = input.runProcess ?? runProcess;
  if (platform === "darwin") return new MacOsKeychainStore(run);
  if (platform === "linux") return new LinuxSecretServiceStore(run);
  return new UnsupportedCredentialStore(platform);
}

export function credentialSourceLabel(kind: CredentialStoreKind) {
  if (kind === "macos-keychain") return "macOS Keychain" as const;
  if (kind === "linux-secret-service") return "Linux Secret Service" as const;
  return "secure credential store" as const;
}
