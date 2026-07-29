import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CredentialStoreUnavailableError,
  DEFAULT_DMFASTER_API_URL,
  type CredentialStore,
} from "@dmfaster/local-auth";

import { resolveMcpClientOptions } from "../src/server.ts";

function generatedToken() {
  return `dmf_pat_${randomBytes(32).toString("hex")}`;
}

function unusedHome() {
  return join(tmpdir(), `dmfaster-mcp-${randomBytes(8).toString("hex")}`);
}

test("MCP resolves the same OS credential and production default as the CLI", async () => {
  const token = generatedToken();
  const accounts: string[] = [];
  const store: CredentialStore = {
    kind: "macos-keychain",
    async get(baseUrl) { accounts.push(baseUrl); return token; },
    async set() {},
    async delete() {},
  };

  const options = await resolveMcpClientOptions({}, {
    homeDirectory: unusedHome(),
    credentialStore: store,
  });

  assert.equal(options.baseUrl, DEFAULT_DMFASTER_API_URL);
  assert.equal(options.token, token);
  assert.deepEqual(accounts, [DEFAULT_DMFASTER_API_URL]);
});

test("MCP gives DMFASTER_TOKEN precedence without reading the OS credential store", async () => {
  const token = generatedToken();
  let reads = 0;
  const store: CredentialStore = {
    kind: "macos-keychain",
    async get() { reads += 1; return null; },
    async set() {},
    async delete() {},
  };

  const options = await resolveMcpClientOptions({
    DMFASTER_TOKEN: token,
    DMFASTER_API_URL: "https://app.dmfaster.test",
    DMFASTER_TIMEOUT_MS: "20000",
  }, {
    homeDirectory: unusedHome(),
    credentialStore: store,
  });

  assert.equal(options.baseUrl, "https://app.dmfaster.test");
  assert.equal(options.token, token);
  assert.equal(options.timeoutMs, 20_000);
  assert.equal(reads, 0);
});

test("MCP fails closed with actionable guidance when no secure store is available", async () => {
  const store: CredentialStore = {
    kind: "unsupported",
    async get() {
      throw new CredentialStoreUnavailableError(
        "Secure storage unavailable. Set DMFASTER_TOKEN; no plaintext fallback is used.",
      );
    },
    async set() {},
    async delete() {},
  };

  await assert.rejects(
    resolveMcpClientOptions({}, { homeDirectory: unusedHome(), credentialStore: store }),
    /DMFASTER_TOKEN.*plaintext fallback/,
  );
});
