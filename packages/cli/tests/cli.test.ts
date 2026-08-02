import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  AGENT_TOOL_POLICIES,
  type AgentToolInputMap,
  type AgentToolName,
  type AgentToolResult,
} from "@dmfaster/sdk";
import { DmfasterHttpError } from "@dmfaster/sdk";

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
          policy: AGENT_TOOL_POLICIES[tool],
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
  assert.match(stdout.read(), /Agent quick start/);
  assert.match(stdout.read(), /setup\.resume/);
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

test("maps workspace-read CLI arguments to the public tool contract", async () => {
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

test("loads stateless campaign input from a bounded JSON file", async () => {
  const calls: Array<{ tool: AgentToolName; input: unknown }> = [];
  const state = { profile: { version: 1 }, brief: { version: 1 } };
  const exitCode = await runCli(
    ["campaign", "prepare", "--state", "/tmp/plan.json", "--idempotency-key", "campaign:prepare:1"],
    {
      ...configuredContext(calls),
      readTextFile: async (path) => {
        assert.equal(path, "/tmp/plan.json");
        return JSON.stringify({ state });
      },
    },
  );
  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    tool: "campaign.prepare",
    input: { state, idempotencyKey: "campaign:prepare:1" },
  }]);
});

test("requires matching preflight fields for campaign actions", async () => {
  const calls: Array<{ tool: AgentToolName; input: unknown }> = [];
  const authorizationId = `agent_action_${"a".repeat(32)}`;
  const exitCode = await runCli(
    [
      "campaign",
      "launch",
      "campaign_123",
      "--idempotency-key",
      "launch:campaign_123:1",
      "--authorization-id",
      authorizationId,
    ],
    configuredContext(calls),
  );
  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    tool: "campaign.launch",
    input: {
      campaignId: "campaign_123",
      idempotencyKey: "launch:campaign_123:1",
      authorizationId,
    },
  }]);
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

test("rejects an explicitly empty optional campaign identifier", async () => {
  const calls: Array<{ tool: AgentToolName; input: unknown }> = [];
  const stderr = output();
  const exitCode = await runCli(
    ["campaign", "inspect", "   "],
    { ...configuredContext(calls), stderr: stderr.stream },
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(calls, []);
  assert.match(stderr.read(), /Campaign identifiers cannot be empty/);
});

test("prints typed retry metadata from SDK transport failures", async () => {
  const stderr = output();
  const exitCode = await runCli(["--json", "workspace", "briefing"], {
    ...configuredContext([]),
    stderr: stderr.stream,
    createClient: () => ({
      async invoke() {
        throw new DmfasterHttpError({
          message: "Too many agent tool requests.",
          status: 429,
          responseBody: null,
          code: "rate_limited",
          retryable: true,
          requestId: "req_cli_123",
          retryAfterSeconds: 90,
        });
      },
    }),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(stderr.read()), {
    error: {
      code: "rate_limited",
      message: "Too many agent tool requests.",
      retryable: true,
      requestId: "req_cli_123",
      retryAfterSeconds: 90,
      status: 429,
    },
  });
});
