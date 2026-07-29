import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import type {
  AgentToolInputMap,
  AgentToolName,
  AgentToolResult,
} from "@dmfaster/sdk";

import { runCli, type CliContext } from "../src/cli.ts";

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

function authIdentity() {
  return {
    authenticated: true,
    credential: {
      id: `agent_cred_${randomBytes(8).toString("hex")}`,
      name: "DM Faster CLI",
      client: "DM Faster CLI",
      scopes: ["workspace:read"],
      expiresAt: "2026-08-28T12:00:00.000Z",
    },
    workspace: { id: "workspace_123", name: "Workspace" },
    user: { id: "user_123", name: "User" },
  };
}

function configuredContext(calls: Array<{ tool: AgentToolName; input: unknown }>): CliContext {
  const token = generatedToken();
  return {
    resolveConfig: async () => ({
      baseUrl: "https://app.dmfaster.test",
      baseUrlSource: "default",
      token,
      tokenSource: "DMFASTER_TOKEN",
      credentialStoreError: null,
      configPath: "/tmp/dmfaster-test-config.json",
    }),
    fetch: async () => Response.json(authIdentity()),
    createClient: () => ({
      async invoke<Name extends AgentToolName>(tool: Name, input: AgentToolInputMap[Name]) {
        calls.push({ tool, input });
        return {
          version: 1,
          tool,
          policy: { effect: "read", approval: "none", exposure: "public_api" },
          ok: true,
          generatedAt: "2026-07-29T12:00:00.000Z",
          durationMs: 1,
          evidence: [],
          consistency: { status: "verified", checks: [] },
          data: {},
          artifacts: [],
          error: null,
        } satisfies AgentToolResult;
      },
    }),
  };
}

test("prints useful help without requiring configuration", async () => {
  const stdout = output();
  const exitCode = await runCli(["--help"], { stdout: stdout.stream });
  assert.equal(exitCode, 0);
  assert.match(stdout.read(), /workspace briefing/);
  assert.match(stdout.read(), /DMFASTER_TOKEN/);
});

test("reports local authentication status without printing the token", async () => {
  const stdout = output();
  const exitCode = await runCli(["auth", "status"], {
    ...configuredContext([]),
    stdout: stdout.stream,
  });
  assert.equal(exitCode, 0);
  assert.match(stdout.read(), /"status": "authenticated"/);
  assert.match(stdout.read(), /"verifiedRemotely": true/);
  assert.doesNotMatch(stdout.read(), /dmf_pat_/);
});

test("gives an actionable error when an API command has no token", async () => {
  const stderr = output();
  const exitCode = await runCli(["workspace", "briefing"], {
    stderr: stderr.stream,
    resolveConfig: async () => ({
      baseUrl: "https://app.dmfaster.test",
      baseUrlSource: "default",
      token: null,
      tokenSource: null,
      credentialStoreError: null,
      configPath: "/tmp/dmfaster/config.json",
    }),
  });
  assert.equal(exitCode, 2);
  assert.match(stderr.read(), /DMFASTER_TOKEN/);
  assert.match(stderr.read(), /dmfaster auth login/);
});

test("maps read-only CLI arguments to the public tool contract", async () => {
  const calls: Array<{ tool: AgentToolName; input: unknown }> = [];
  const stdout = output();
  const exitCode = await runCli(
    ["replies", "list", "campaign_123", "--limit", "7", "--query", "Visio"],
    { ...configuredContext(calls), stdout: stdout.stream },
  );
  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    tool: "replies.list",
    input: { campaignId: "campaign_123", limit: 7, query: "Visio" },
  }]);
  assert.match(stdout.read(), /"tool": "replies.list"/);
});

test("maps company timeline identifiers to the public tool contract", async () => {
  const calls: Array<{ tool: AgentToolName; input: unknown }> = [];
  const stdout = output();
  const exitCode = await runCli(
    ["company", "timeline", "campaign_123", "outreach_456"],
    { ...configuredContext(calls), stdout: stdout.stream },
  );
  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    tool: "company.timeline",
    input: { campaignId: "campaign_123", companyOutreachId: "outreach_456" },
  }]);
  assert.match(stdout.read(), /"tool": "company.timeline"/);
});
