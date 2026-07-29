import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_DMFASTER_API_URL,
  normalizeApiBaseUrl,
  resolveLocalAuthConfig,
  type CredentialStore,
} from "../src/index.ts";

function generatedToken() {
  return `dmf_pat_${randomBytes(32).toString("hex")}`;
}

test("prefers an environment credential and production endpoint without touching the OS store", async () => {
  const token = generatedToken();
  let storeReads = 0;
  const store: CredentialStore = {
    kind: "unsupported",
    async get() { storeReads += 1; return null; },
    async set() {},
    async delete() {},
  };
  const config = await resolveLocalAuthConfig({
    env: { DMFASTER_TOKEN: token },
    homeDirectory: join(tmpdir(), randomBytes(8).toString("hex")),
    credentialStore: store,
  });

  assert.equal(config.baseUrl, DEFAULT_DMFASTER_API_URL);
  assert.equal(config.token, token);
  assert.equal(config.tokenSource, "DMFASTER_TOKEN");
  assert.equal(storeReads, 0);
});

test("loads a secure-store credential for the configured API origin", async () => {
  const token = generatedToken();
  const accounts: string[] = [];
  const store: CredentialStore = {
    kind: "macos-keychain",
    async get(baseUrl) { accounts.push(baseUrl); return token; },
    async set() {},
    async delete() {},
  };
  const config = await resolveLocalAuthConfig({
    env: { DMFASTER_API_URL: "https://app.dmfaster.test/" },
    homeDirectory: join(tmpdir(), randomBytes(8).toString("hex")),
    credentialStore: store,
  });

  assert.equal(config.baseUrl, "https://app.dmfaster.test");
  assert.equal(config.token, token);
  assert.equal(config.tokenSource, "macOS Keychain");
  assert.deepEqual(accounts, ["https://app.dmfaster.test"]);
});

test("rejects any plaintext credential field in the config file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dmfaster-auth-config-"));
  const path = join(directory, "config.json");
  try {
    await writeFile(path, JSON.stringify({ token: true }), { mode: 0o600 });
    await assert.rejects(
      resolveLocalAuthConfig({
        env: { DMFASTER_CONFIG: path },
        homeDirectory: directory,
      }),
      /unsupported plaintext token/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects API base URLs with a pathname before resolving credentials", () => {
  assert.throws(
    () => normalizeApiBaseUrl("https://app.dmfaster.test/some/path"),
    /origin without a pathname/,
  );
});
