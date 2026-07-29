import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

import {
  AgentAuthError,
  beginDeviceAuthorization,
  createPkcePair,
  getRemoteAuthStatus,
  pollDeviceAuthorization,
  revokeRemoteCredential,
  sanitizeDeviceName,
} from "../src/index.ts";

const BASE_URL = "https://app.dmfaster.test";

function generatedToken() {
  return `dmf_pat_${randomBytes(32).toString("hex")}`;
}

function generatedConfirmationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const code = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function generatedDeviceResponse() {
  const requestId = `agent_auth_${randomBytes(16).toString("hex")}`;
  return {
    deviceCode: `dmf_device_${randomBytes(32).toString("base64url")}`,
    confirmationCode: generatedConfirmationCode(),
    verificationUrl: `${BASE_URL}/connect/agent/${requestId}`,
    expiresIn: 300,
    interval: 5,
  };
}

function identity(accessToken = generatedToken()) {
  return {
    accessToken,
    tokenType: "Bearer",
    credential: {
      id: `agent_cred_${randomBytes(8).toString("hex")}`,
      name: "DM Faster CLI",
      client: "DM Faster CLI",
      scopes: ["workspace:read", "campaigns:read", "sending:read", "inbox:read", "pipeline:read"],
      expiresAt: "2026-08-28T12:00:00.000Z",
    },
    workspace: { id: `workspace_${randomBytes(8).toString("hex")}`, name: "Workspace" },
    user: { id: `user_${randomBytes(8).toString("hex")}`, name: "User" },
  };
}

test("creates an S256 PKCE pair from exactly 32 random bytes", () => {
  const source = randomBytes(32);
  const pair = createPkcePair((size) => {
    assert.equal(size, 32);
    return source;
  });
  assert.match(pair.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    pair.codeChallenge,
    createHash("sha256").update(pair.codeVerifier, "ascii").digest("base64url"),
  );
});

test("starts device auth with a public challenge and a secret-free verification URL", async () => {
  const server = generatedDeviceResponse();
  let requestBody: Record<string, unknown> | null = null;
  const authorization = await beginDeviceAuthorization({
    baseUrl: BASE_URL,
    adapters: {
      randomBytes: () => randomBytes(32),
      hostname: () => `  My\nMac ${"x".repeat(120)}  `,
      fetch: async (url, init) => {
        assert.equal(String(url), `${BASE_URL}/api/v1/agent/auth/device`);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json(server, { status: 201 });
      },
    },
  });

  assert.equal(requestBody?.codeChallengeMethod, "S256");
  assert.equal(requestBody?.client, "DM Faster CLI");
  assert.equal(typeof requestBody?.deviceName, "string");
  assert.equal(String(requestBody?.deviceName).length, 100);
  assert.doesNotMatch(String(requestBody?.deviceName), /[\r\n\t]/);
  assert.equal(requestBody?.expiresInDays, 30);
  assert.ok(Array.isArray(requestBody?.scopes));
  assert.equal("codeVerifier" in (requestBody ?? {}), false);
  assert.equal("deviceCode" in (requestBody ?? {}), false);
  assert.equal(new URL(authorization.verificationUrl).search, "");
  assert.equal(authorization.confirmationCode, server.confirmationCode);
});

test("uses an actionable fallback for an unusable hostname", () => {
  assert.equal(sanitizeDeviceName("\n\t"), "This computer");
});

test("refuses to open an unrelated same-origin route from a malformed server response", async () => {
  const server = { ...generatedDeviceResponse(), verificationUrl: `${BASE_URL}/settings` };
  await assert.rejects(
    beginDeviceAuthorization({
      baseUrl: BASE_URL,
      adapters: { fetch: async () => Response.json(server, { status: 201 }) },
    }),
    /unexpected browser verification path/,
  );
});

test("rejects confirmation codes containing ambiguous characters", async () => {
  const server = { ...generatedDeviceResponse(), confirmationCode: "I0O1-ABCD" };
  await assert.rejects(
    beginDeviceAuthorization({
      baseUrl: BASE_URL,
      adapters: { fetch: async () => Response.json(server, { status: 201 }) },
    }),
    /invalid confirmation code/,
  );
});

test("polls at the server interval, respects slow-down, and returns a validated credential", async () => {
  const server = generatedDeviceResponse();
  const resultBody = identity();
  let now = 0;
  const sleeps: number[] = [];
  let pollCount = 0;
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/device")) return Response.json(server, { status: 201 });
    assert.equal(String(url), `${BASE_URL}/api/v1/agent/auth/token`);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(typeof body.deviceCode, "string");
    assert.equal(typeof body.codeVerifier, "string");
    pollCount += 1;
    if (pollCount === 1) {
      return Response.json({ error: "authorization_pending", interval: 5 }, { status: 428 });
    }
    if (pollCount === 2) {
      return Response.json({ error: "slow_down" }, { status: 429, headers: { "retry-after": "9" } });
    }
    return Response.json(resultBody);
  };
  const authorization = await beginDeviceAuthorization({ baseUrl: BASE_URL, adapters: { fetch } });
  const result = await pollDeviceAuthorization({
    baseUrl: BASE_URL,
    authorization,
    adapters: {
      fetch,
      now: () => now,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); now += milliseconds; },
    },
  });

  assert.deepEqual(sleeps, [5_000, 5_000, 10_000]);
  assert.equal(result.accessToken, resultBody.accessToken);
  assert.equal(result.workspace.id, resultBody.workspace.id);
});

test("reports browser denial and timeout without including in-memory secrets", async () => {
  const server = generatedDeviceResponse();
  let now = 0;
  const fetch = async (url: string | URL | Request) => String(url).endsWith("/device")
    ? Response.json(server, { status: 201 })
    : Response.json({ error: "access_denied" }, { status: 403 });
  const authorization = await beginDeviceAuthorization({ baseUrl: BASE_URL, adapters: { fetch } });

  await assert.rejects(
    pollDeviceAuthorization({
      baseUrl: BASE_URL,
      authorization,
      adapters: { fetch, now: () => now, sleep: async (milliseconds) => { now += milliseconds; } },
    }),
    (error: unknown) => error instanceof AgentAuthError
      && error.code === "access_denied"
      && !error.message.includes(server.deviceCode),
  );

  now = 0;
  const shortAuthorization = { ...authorization, expiresIn: 30, interval: 30 };
  await assert.rejects(
    pollDeviceAuthorization({
      baseUrl: BASE_URL,
      authorization: shortAuthorization,
      adapters: {
        fetch: async () => { throw new Error("poll should not run after deadline"); },
        now: () => now,
        sleep: async (milliseconds) => { now += milliseconds; },
      },
    }),
    (error: unknown) => error instanceof AgentAuthError && error.code === "expired_token",
  );
});

test("verifies status and revokes through bearer-only headers, never URL parameters", async () => {
  const body = identity();
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: String(init?.method),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return String(url).endsWith("/status")
      ? Response.json({ authenticated: true, ...body })
      : Response.json({ revoked: true });
  };

  const status = await getRemoteAuthStatus({ baseUrl: BASE_URL, token: body.accessToken, fetch });
  await revokeRemoteCredential({ baseUrl: BASE_URL, token: body.accessToken, fetch });

  assert.equal(status.credential.id, body.credential.id);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "POST"]);
  assert.ok(calls.every((call) => !call.url.includes(body.accessToken)));
  assert.ok(calls.every((call) => call.authorization === `Bearer ${body.accessToken}`));
});
