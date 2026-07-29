import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  CredentialStoreUnavailableError,
  createBrowserOpener,
  createSystemCredentialStore,
  normalizeAgentAccessToken,
  type ProcessResult,
  type RunProcess,
} from "../src/index.ts";

function generatedToken() {
  return `dmf_pat_${randomBytes(32).toString("hex")}`;
}

function success(stdout = ""): ProcessResult {
  return { exitCode: 0, stdout, stderr: "" };
}

test("accepts only the exact current DM Faster PAT shape", () => {
  const token = generatedToken();
  assert.equal(normalizeAgentAccessToken(token), token);
  assert.throws(() => normalizeAgentAccessToken("dmf_pat_"), /invalid access token/);
  assert.throws(() => normalizeAgentAccessToken(token.toUpperCase()), /invalid access token/);
});

test("writes macOS Keychain credentials through stdin without placing secrets in argv", async () => {
  const token = generatedToken();
  const calls: Array<{ executable: string; args: readonly string[]; stdin?: string }> = [];
  const run: RunProcess = async (executable, args, options) => {
    calls.push({ executable, args, ...(options?.stdin ? { stdin: options.stdin } : {}) });
    return success();
  };
  const store = createSystemCredentialStore({ platform: "darwin", runProcess: run });

  await store.set("https://app.dmfaster.test", token);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.executable, "/usr/bin/security");
  assert.deepEqual(calls[0]?.args, ["-i"]);
  assert.ok(calls[0]?.stdin?.endsWith(`${token}\n`));
  assert.ok(calls.every((call) => call.args.every((argument) => !argument.includes(token))));
});

test("reads and deletes a macOS Keychain credential without exposing it in arguments", async () => {
  const token = generatedToken();
  const calls: Array<readonly string[]> = [];
  const run: RunProcess = async (_executable, args) => {
    calls.push(args);
    return args[0] === "find-generic-password" ? success(`${token}\n`) : success();
  };
  const store = createSystemCredentialStore({ platform: "darwin", runProcess: run });

  assert.equal(await store.get("https://app.dmfaster.test"), token);
  await store.delete("https://app.dmfaster.test");

  assert.deepEqual(calls.map((args) => args[0]), ["find-generic-password", "delete-generic-password"]);
  assert.ok(calls.every((args) => args.every((argument) => !argument.includes(token))));
});

test("uses Linux Secret Service stdin and fails closed when secure storage is unsupported", async () => {
  const token = generatedToken();
  const calls: Array<{ args: readonly string[]; stdin?: string }> = [];
  const run: RunProcess = async (_executable, args, options) => {
    calls.push({ args, ...(options?.stdin ? { stdin: options.stdin } : {}) });
    return success();
  };
  const linuxStore = createSystemCredentialStore({ platform: "linux", runProcess: run });
  await linuxStore.set("https://app.dmfaster.test", token);
  assert.equal(calls[0]?.stdin, `${token}\n`);
  assert.ok(calls[0]?.args.every((argument) => !argument.includes(token)));

  const unsupported = createSystemCredentialStore({ platform: "win32", runProcess: run });
  await assert.rejects(
    unsupported.get("https://app.dmfaster.test"),
    (error: unknown) => error instanceof CredentialStoreUnavailableError
      && /DMFASTER_TOKEN/.test(error.message)
      && /plaintext fallback/.test(error.message),
  );
});

test("opens only the server verification URL and never puts auth secrets in browser argv", async () => {
  const secrets = [generatedToken(), randomBytes(32).toString("base64url"), randomBytes(32).toString("hex")];
  const calls: Array<{ executable: string; args: readonly string[] }> = [];
  const run: RunProcess = async (executable, args) => {
    calls.push({ executable, args });
    return success();
  };
  const open = createBrowserOpener({ platform: "darwin", runProcess: run });
  const requestId = `agent_auth_${randomBytes(16).toString("hex")}`;
  await open(`https://app.dmfaster.test/connect/agent/${requestId}`);

  assert.equal(calls[0]?.executable, "/usr/bin/open");
  assert.equal(calls[0]?.args.length, 1);
  assert.ok(calls.every((call) => call.args.every((argument) => (
    secrets.every((secret) => !argument.includes(secret))
  ))));
});
