import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_TOOL_POLICIES,
  type AgentToolInputMap,
  type AgentToolName,
  type AgentToolResult,
} from "@dmfaster/sdk";
import { DmfasterHttpError } from "@dmfaster/sdk";

import {
  MCP_AGENT_TOOL_NAMES,
  registerAgentToolDefinitions,
  type AgentInvoker,
  type AgentToolDefinition,
} from "../src/tools.ts";
import { toolFailure } from "../src/server.ts";

function result(tool: AgentToolName): AgentToolResult {
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
  };
}

function fakeClient(calls: Array<{ tool: AgentToolName; input: unknown }>): AgentInvoker {
  return {
    async invoke<Name extends AgentToolName>(tool: Name, input: AgentToolInputMap[Name]) {
      calls.push({ tool, input });
      return result(tool);
    },
  };
}

test("registers the complete Agent 1.0 surface with honest MCP safety hints", () => {
  const definitions: AgentToolDefinition[] = [];
  registerAgentToolDefinitions({ register: (definition) => definitions.push(definition) }, fakeClient([]));

  assert.deepEqual(definitions.map((definition) => definition.name), MCP_AGENT_TOOL_NAMES);
  for (const definition of definitions.slice(0, 10)) {
    assert.deepEqual(definition.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  }
  for (const name of [
    "list_prepare",
    "campaign_prepare",
    "campaign_launch_preflight",
    "campaign_pause_preflight",
    "campaign_pause",
  ]) {
    assert.deepEqual(definitions.find((definition) => definition.name === name)?.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  }
  assert.deepEqual(
    definitions.find((definition) => definition.name === "campaign_launch")?.annotations,
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  );
});

test("maps MCP tool names and validated inputs onto SDK calls", async () => {
  const calls: Array<{ tool: AgentToolName; input: unknown }> = [];
  const definitions: AgentToolDefinition[] = [];
  registerAgentToolDefinitions({ register: (definition) => definitions.push(definition) }, fakeClient(calls));

  const replies = definitions.find((definition) => definition.name === "replies_list");
  const timeline = definitions.find((definition) => definition.name === "company_timeline");
  const preflight = definitions.find((definition) => definition.name === "campaign_launch_preflight");
  const launch = definitions.find((definition) => definition.name === "campaign_launch");
  assert.ok(replies);
  assert.ok(timeline);
  assert.ok(preflight);
  assert.ok(launch);
  assert.match(preflight.description, /setup_required/u);
  assert.match(preflight.description, /setup\.resume/u);
  assert.match(launch.description, /browser_worker_required/u);

  await replies.call({ campaignId: "campaign_123", limit: 4, query: "Visio" });
  await timeline.call({ campaignId: "campaign_123", companyOutreachId: "outreach_456" });
  await preflight.call({ campaignId: "campaign_123", idempotencyKey: "launch:campaign_123:1" });
  await launch.call({
    campaignId: "campaign_123",
    idempotencyKey: "launch:campaign_123:1",
    authorizationId: `agent_action_${"a".repeat(32)}`,
  });

  assert.deepEqual(calls, [
    {
      tool: "replies.list",
      input: { campaignId: "campaign_123", limit: 4, query: "Visio" },
    },
    {
      tool: "company.timeline",
      input: { campaignId: "campaign_123", companyOutreachId: "outreach_456" },
    },
    {
      tool: "campaign.launch.preflight",
      input: { campaignId: "campaign_123", idempotencyKey: "launch:campaign_123:1" },
    },
    {
      tool: "campaign.launch",
      input: {
        campaignId: "campaign_123",
        idempotencyKey: "launch:campaign_123:1",
        authorizationId: `agent_action_${"a".repeat(32)}`,
      },
    },
  ]);
});

test("rejects unknown input fields before calling the SDK", async () => {
  const calls: Array<{ tool: AgentToolName; input: unknown }> = [];
  const definitions: AgentToolDefinition[] = [];
  registerAgentToolDefinitions({ register: (definition) => definitions.push(definition) }, fakeClient(calls));
  const briefing = definitions.find((definition) => definition.name === "workspace_briefing");
  assert.ok(briefing);

  await assert.rejects(briefing.call({ approved: true }), /Unrecognized key/);
  assert.deepEqual(calls, []);
});

test("preserves the SDK transport retry contract in MCP failures", () => {
  const failure = toolFailure(new DmfasterHttpError({
    message: "Too many agent tool requests.",
    status: 429,
    responseBody: null,
    code: "rate_limited",
    retryable: true,
    requestId: "req_mcp_123",
    retryAfterSeconds: 120,
    details: { bucket: "workspace" },
  }));

  assert.deepEqual(failure.structuredContent, {
    error: {
      code: "rate_limited",
      message: "Too many agent tool requests.",
      retryable: true,
      requestId: "req_mcp_123",
      retryAfterSeconds: 120,
      details: { bucket: "workspace" },
      status: 429,
    },
  });
  assert.equal(failure.isError, true);
});
