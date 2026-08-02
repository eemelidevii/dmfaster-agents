import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  LoginLockLostError,
  type CredentialStore,
  type LocalCredentialSource,
} from "@dmfaster/local-auth";

import { runCli, type CliContext } from "../src/cli.ts";
import type { ResolvedCliConfig } from "../src/config.ts";

const BASE_URL = "https://app.dmfaster.test";

function output() {
  let value = "";
  return {
    stream: { write(chunk: string) { value += chunk; } },
    read: () => value,
  };
}

function generatedToken() {
  return `dmf_pat_${randomBytes(32).toString("hex")}`;
}

function generatedConfirmationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const code = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function config(token: string | null, tokenSource: LocalCredentialSource): ResolvedCliConfig {
  return {
    baseUrl: BASE_URL,
    baseUrlSource: "default",
    token,
    tokenSource,
    credentialStoreError: null,
    configPath: "/tmp/dmfaster/config.json",
  };
}

function deviceResponse() {
  return {
    deviceCode: `dmf_device_${randomBytes(32).toString("base64url")}`,
    confirmationCode: generatedConfirmationCode(),
    verificationUrl: `${BASE_URL}/connect/agent/agent_auth_${randomBytes(16).toString("hex")}`,
    expiresIn: 300,
    interval: 5,
  };
}

function successfulExchange(token: string) {
  return {
    accessToken: token,
    tokenType: "Bearer",
    expiresAt: "2026-08-28T12:00:00.000Z",
    scope: "workspace:read campaigns:read sending:read inbox:read pipeline:read audiences:read campaigns:write campaigns:launch",
    credential: {
      id: `agent_cred_${randomBytes(8).toString("hex")}`,
      name: "DM Faster CLI",
      client: "DM Faster CLI",
      scopes: [
        "workspace:read",
        "campaigns:read",
        "sending:read",
        "inbox:read",
        "pipeline:read",
        "audiences:read",
        "campaigns:write",
        "campaigns:launch",
      ],
      expiresAt: "2026-08-28T12:00:00.000Z",
    },
    workspace: { id: "workspace_123", name: "Workspace" },
    user: { id: "user_123", name: "User" },
  };
}

function fakeStore(input: {
  existing?: string | null;
  onGet?: () => void | Promise<void>;
  onSet?: (token: string) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
} = {}): CredentialStore {
  return {
    kind: "macos-keychain",
    async get() { await input.onGet?.(); return input.existing ?? null; },
    async set(_baseUrl, token) { await input.onSet?.(token); },
    async delete() { await input.onDelete?.(); },
  };
}

function fakeLoginLock(events?: string[], onRelease?: () => void | Promise<void>) {
  return async () => {
    events?.push("lock:acquire");
    return {
      async assertOwned() { events?.push("lock:assert"); },
      async release() {
        events?.push("lock:release");
        await onRelease?.();
      },
    };
  };
}

function instantPolling() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (milliseconds: number) => { now += milliseconds; },
    randomBytes: (size: number) => randomBytes(size),
  };
}

test("browser login prints the confirmation code, opens the server URL, and stores only the token", async () => {
  const stdout = output();
  const stderr = output();
  const server = deviceResponse();
  const token = generatedToken();
  let savedToken: string | null = null;
  let openedUrl = "";
  let codeVerifier = "";
  let requestedScopes: unknown = null;
  const lifecycle: string[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/device")) {
      requestedScopes = (JSON.parse(String(init?.body)) as Record<string, unknown>).scopes;
      return Response.json(server, { status: 201 });
    }
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    codeVerifier = String(request.codeVerifier || "");
    return Response.json(successfulExchange(token));
  };
  const context: CliContext = {
    stdout: stdout.stream,
    stderr: stderr.stream,
    resolveConfig: async () => config(null, null),
    credentialStore: fakeStore({
      onGet() { lifecycle.push("store:get"); },
      onSet(value) { savedToken = value; lifecycle.push("store:set"); },
    }),
    acquireLoginLock: fakeLoginLock(lifecycle),
    openBrowser: async (url) => { openedUrl = url; lifecycle.push("browser:open"); },
    fetch,
    deviceAuthAdapters: instantPolling(),
  };

  const exitCode = await runCli(["auth", "login"], context);

  assert.equal(exitCode, 0);
  assert.equal(savedToken, token);
  assert.equal(openedUrl, server.verificationUrl);
  assert.deepEqual(requestedScopes, successfulExchange(token).credential.scopes);
  assert.deepEqual(lifecycle, [
    "lock:acquire",
    "store:get",
    "browser:open",
    "lock:assert",
    "store:set",
    "lock:release",
  ]);
  assert.match(stdout.read(), new RegExp(server.confirmationCode));
  assert.match(stderr.read(), /Check that this code matches/);
  assert.match(stdout.read(), /"status":"authenticated"/);
  const events = stdout.read().trim().split("\n").map((line) => JSON.parse(line) as {
    event: string;
    requestedAccess?: string;
  });
  assert.deepEqual(events.map((event) => event.event), ["authorization_required", "authenticated"]);
  assert.equal(events[0]?.requestedAccess, "full");
  for (const secret of [token, server.deviceCode, codeVerifier]) {
    assert.ok(secret);
    assert.doesNotMatch(stdout.read(), new RegExp(secret));
    assert.doesNotMatch(stderr.read(), new RegExp(secret));
  }
});

test("browser login can request the plan-only access profile", async () => {
  const server = deviceResponse();
  const token = generatedToken();
  let requestedScopes: unknown = null;
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/device")) {
      requestedScopes = (JSON.parse(String(init?.body)) as Record<string, unknown>).scopes;
      return Response.json(server, { status: 201 });
    }
    return Response.json(successfulExchange(token));
  };

  const exitCode = await runCli(["auth", "login", "--access", "plan"], {
    stdout: output().stream,
    stderr: output().stream,
    resolveConfig: async () => config(null, null),
    credentialStore: fakeStore(),
    acquireLoginLock: fakeLoginLock(),
    openBrowser: async () => {},
    fetch,
    deviceAuthAdapters: instantPolling(),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(requestedScopes, [
    "workspace:read",
    "campaigns:read",
    "sending:read",
    "inbox:read",
    "pipeline:read",
    "audiences:read",
  ]);
});

test("browser login rejects unknown access profiles before device authorization", async () => {
  const stderr = output();
  let fetchCalls = 0;
  const exitCode = await runCli(["auth", "login", "--access", "administrator"], {
    stdout: output().stream,
    stderr: stderr.stream,
    resolveConfig: async () => config(null, null),
    credentialStore: fakeStore(),
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("device authorization should not start");
    },
  });

  assert.equal(exitCode, 2);
  assert.equal(fetchCalls, 0);
  assert.match(stderr.read(), /--access must be one of: read, plan, draft, full/);
});

test("browser login succeeds with a warning when cleanup fails after secure persistence", async () => {
  const stdout = output();
  const stderr = output();
  const server = deviceResponse();
  const token = generatedToken();
  let savedToken: string | null = null;
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/device")) return Response.json(server, { status: 201 });
    assert.ok(init?.body);
    return Response.json(successfulExchange(token));
  };

  const exitCode = await runCli(["auth", "login"], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    resolveConfig: async () => config(null, null),
    credentialStore: fakeStore({ onSet(value) { savedToken = value; } }),
    acquireLoginLock: fakeLoginLock(undefined, async () => {
      throw new Error("lock cleanup unavailable");
    }),
    openBrowser: async () => {},
    fetch,
    deviceAuthAdapters: instantPolling(),
  });

  assert.equal(exitCode, 0);
  assert.equal(savedToken, token);
  assert.match(stdout.read(), /"status":"authenticated"/);
  assert.match(stderr.read(), /warning: Authentication succeeded, but browser-login lock cleanup failed/);
  assert.match(stderr.read(), /lock cleanup unavailable/);
});

test("browser login never overwrites an existing stored credential", async () => {
  const token = generatedToken();
  const stderr = output();
  let deviceCalls = 0;
  let writes = 0;
  let lockCalls = 0;
  const exitCode = await runCli(["auth", "login"], {
    stdout: output().stream,
    stderr: stderr.stream,
    resolveConfig: async () => config(token, "macOS Keychain"),
    credentialStore: fakeStore({ existing: token, onSet() { writes += 1; } }),
    acquireLoginLock: async () => {
      lockCalls += 1;
      return { async assertOwned() {}, async release() {} };
    },
    fetch: async () => { deviceCalls += 1; throw new Error("should not request a device code"); },
  });

  assert.equal(exitCode, 2);
  assert.equal(deviceCalls, 0);
  assert.equal(writes, 0);
  assert.equal(lockCalls, 0);
  assert.match(stderr.read(), /auth logout/);
  assert.doesNotMatch(stderr.read(), new RegExp(token));
});

test("revokes the new remote credential when secure storage fails", async () => {
  const stderr = output();
  const server = deviceResponse();
  const token = generatedToken();
  let revokeCalls = 0;
  const fetch = async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith("/device")) return Response.json(server, { status: 201 });
    if (path.endsWith("/token")) return Response.json(successfulExchange(token));
    if (path.endsWith("/revoke")) {
      revokeCalls += 1;
      return Response.json({ revoked: true });
    }
    throw new Error("unexpected request");
  };

  const exitCode = await runCli(["auth", "login"], {
    stderr: stderr.stream,
    stdout: output().stream,
    resolveConfig: async () => config(null, null),
    credentialStore: fakeStore({ async onSet() { throw new Error("Secure storage failed."); } }),
    acquireLoginLock: fakeLoginLock(undefined, async () => {
      throw new Error("lock cleanup unavailable");
    }),
    openBrowser: async () => {},
    fetch,
    deviceAuthAdapters: instantPolling(),
  });

  assert.equal(exitCode, 1);
  assert.equal(revokeCalls, 1);
  assert.match(stderr.read(), /Secure storage failed/);
  assert.doesNotMatch(stderr.read(), /Authentication succeeded/);
  assert.doesNotMatch(stderr.read(), new RegExp(token));
});

test("revokes instead of storing when stale-lock recovery replaced this login", async () => {
  const stderr = output();
  const server = deviceResponse();
  const token = generatedToken();
  let revokeCalls = 0;
  let writes = 0;
  let releases = 0;
  const fetch = async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith("/device")) return Response.json(server, { status: 201 });
    if (path.endsWith("/token")) return Response.json(successfulExchange(token));
    if (path.endsWith("/revoke")) {
      revokeCalls += 1;
      return Response.json({ revoked: true });
    }
    throw new Error("unexpected request");
  };

  const exitCode = await runCli(["auth", "login"], {
    stderr: stderr.stream,
    stdout: output().stream,
    resolveConfig: async () => config(null, null),
    credentialStore: fakeStore({ onSet() { writes += 1; } }),
    acquireLoginLock: async () => ({
      async assertOwned() { throw new LoginLockLostError(); },
      async release() { releases += 1; },
    }),
    openBrowser: async () => {},
    fetch,
    deviceAuthAdapters: instantPolling(),
  });

  assert.equal(exitCode, 1);
  assert.equal(revokeCalls, 1);
  assert.equal(writes, 0);
  assert.equal(releases, 1);
  assert.match(stderr.read(), /lock expired or was recovered/);
  assert.doesNotMatch(stderr.read(), new RegExp(token));
});

test("handles browser denial without storing a credential", async () => {
  const stderr = output();
  const server = deviceResponse();
  let writes = 0;
  const fetch = async (url: string | URL | Request) => String(url).endsWith("/device")
    ? Response.json(server, { status: 201 })
    : Response.json({ error: "access_denied" }, { status: 403 });

  const exitCode = await runCli(["auth", "login"], {
    stdout: output().stream,
    stderr: stderr.stream,
    resolveConfig: async () => config(null, null),
    credentialStore: fakeStore({ onSet() { writes += 1; } }),
    acquireLoginLock: fakeLoginLock(),
    openBrowser: async () => {},
    fetch,
    deviceAuthAdapters: instantPolling(),
  });

  assert.equal(exitCode, 1);
  assert.equal(writes, 0);
  assert.match(stderr.read(), /denied in the browser/);
  assert.doesNotMatch(stderr.read(), new RegExp(server.deviceCode));
});

test("auth status verifies the credential remotely and never prints it", async () => {
  const token = generatedToken();
  const stdout = output();
  let statusCalls = 0;
  const exitCode = await runCli(["auth", "status"], {
    stdout: stdout.stream,
    resolveConfig: async () => config(token, "macOS Keychain"),
    fetch: async (url) => {
      assert.equal(String(url), `${BASE_URL}/api/v1/agent/auth/status`);
      statusCalls += 1;
      return Response.json({ authenticated: true, ...successfulExchange(token) });
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(statusCalls, 1);
  assert.match(stdout.read(), /"verifiedRemotely": true/);
  assert.doesNotMatch(stdout.read(), new RegExp(token));
});

test("auth status identifies revoked workspace access without browser-denial copy", async () => {
  const token = generatedToken();
  const stdout = output();
  const stderr = output();
  const exitCode = await runCli(["auth", "status"], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    resolveConfig: async () => config(token, "macOS Keychain"),
    fetch: async () => Response.json({
      error: { code: "workspace_access_denied", message: "Workspace access is no longer available." },
    }, { status: 403 }),
  });

  assert.equal(exitCode, 1);
  assert.match(stdout.read(), /"status": "invalid"/);
  assert.match(stdout.read(), /"verifiedRemotely": true/);
  assert.match(stderr.read(), /no longer has access to its workspace/);
  assert.doesNotMatch(stderr.read(), /denied in the browser/);
  assert.doesNotMatch(stderr.read(), new RegExp(token));
});

test("auth status --json prints structured rate-limit recovery metadata", async () => {
  const token = generatedToken();
  const stdout = output();
  const stderr = output();
  const exitCode = await runCli(["--json", "auth", "status"], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    resolveConfig: async () => config(token, "macOS Keychain"),
    fetch: async () => Response.json(
      { error: { code: "rate_limited", message: "Authentication rate limit exceeded." } },
      { status: 429, headers: { "retry-after": "75" } },
    ),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(stdout.read()), {
    status: "unavailable",
    verifiedRemotely: false,
    credentialSource: "macOS Keychain",
    baseUrl: BASE_URL,
  });
  assert.deepEqual(JSON.parse(stderr.read()), {
    error: {
      code: "rate_limited",
      message: "DM Faster temporarily rate-limited authentication.",
      retryAfterSeconds: 75,
      status: 429,
    },
  });
  assert.doesNotMatch(stdout.read(), new RegExp(token));
  assert.doesNotMatch(stderr.read(), new RegExp(token));
});

test("logout revokes first and only then deletes the local credential", async () => {
  const token = generatedToken();
  const events: string[] = [];
  const exitCode = await runCli(["auth", "logout"], {
    stdout: output().stream,
    resolveConfig: async () => config(token, "macOS Keychain"),
    credentialStore: fakeStore({ onDelete() { events.push("delete"); } }),
    acquireLoginLock: fakeLoginLock(events),
    fetch: async () => {
      events.push("revoke");
      return Response.json({ revoked: true });
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(events, ["lock:acquire", "revoke", "delete", "lock:release"]);
});

test("logout preserves the local credential when remote revocation cannot be confirmed", async () => {
  const token = generatedToken();
  const stderr = output();
  let deletes = 0;
  const exitCode = await runCli(["auth", "logout"], {
    stdout: output().stream,
    stderr: stderr.stream,
    resolveConfig: async () => config(token, "macOS Keychain"),
    credentialStore: fakeStore({ onDelete() { deletes += 1; } }),
    acquireLoginLock: fakeLoginLock(),
    fetch: async () => { throw new Error("offline"); },
  });

  assert.equal(exitCode, 1);
  assert.equal(deletes, 0);
  assert.match(stderr.read(), /Could not reach DM Faster/);
  assert.doesNotMatch(stderr.read(), new RegExp(token));
});

test("environment-token logout revokes remotely and tells the parent process to unset it", async () => {
  const token = generatedToken();
  const stdout = output();
  let deletes = 0;
  const exitCode = await runCli(["auth", "logout"], {
    stdout: stdout.stream,
    resolveConfig: async () => config(token, "DMFASTER_TOKEN"),
    credentialStore: fakeStore({ onDelete() { deletes += 1; } }),
    fetch: async () => Response.json({ revoked: true }),
  });

  assert.equal(exitCode, 0);
  assert.equal(deletes, 0);
  assert.match(stdout.read(), /Unset DMFASTER_TOKEN/);
  assert.doesNotMatch(stdout.read(), new RegExp(token));
});

test("logout cannot race an in-flight browser login", async () => {
  const token = generatedToken();
  const stderr = output();
  let revokes = 0;
  let deletes = 0;
  const exitCode = await runCli(["auth", "logout"], {
    stdout: output().stream,
    stderr: stderr.stream,
    resolveConfig: async () => config(token, "macOS Keychain"),
    credentialStore: fakeStore({ existing: token, onDelete() { deletes += 1; } }),
    acquireLoginLock: async () => {
      throw new Error("Another DM Faster browser login is already in progress.");
    },
    fetch: async () => {
      revokes += 1;
      return Response.json({ revoked: true });
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(revokes, 0);
  assert.equal(deletes, 0);
  assert.match(stderr.read(), /browser login is already in progress/);
});

test("failed login retries revocation and reports an actionable orphan warning", async () => {
  const server = deviceResponse();
  const token = generatedToken();
  const stderr = output();
  let revokeCalls = 0;
  const fetch = async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith("/device")) return Response.json(server, { status: 201 });
    if (path.endsWith("/token")) return Response.json(successfulExchange(token));
    if (path.endsWith("/revoke")) {
      revokeCalls += 1;
      throw new Error("revocation endpoint unavailable");
    }
    throw new Error("unexpected request");
  };

  const exitCode = await runCli(["auth", "login"], {
    stderr: stderr.stream,
    stdout: output().stream,
    resolveConfig: async () => config(null, null),
    credentialStore: fakeStore({ async onSet() { throw new Error("Secure storage failed."); } }),
    acquireLoginLock: fakeLoginLock(),
    openBrowser: async () => {},
    fetch,
    deviceAuthAdapters: instantPolling(),
  });

  assert.equal(exitCode, 1);
  assert.equal(revokeCalls, 3);
  assert.match(stderr.read(), /could not be revoked after 3 attempts/);
  assert.match(stderr.read(), /Agent access settings/);
  assert.doesNotMatch(stderr.read(), new RegExp(token));
});
