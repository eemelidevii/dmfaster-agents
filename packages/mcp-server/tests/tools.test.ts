import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentToolInputMap,
  AgentToolName,
  AgentToolResult,
} from "@dmfaster/sdk";

import {
  MCP_TOOL_NAMES,
  registerAgentToolDefinitions,
  type AgentInvoker,
  type AgentToolDefinition,
} from "../src/tools.ts";

function result(tool: AgentToolName): AgentToolResult {
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

test("registers exactly the seven read-only Phase 1 tools without an MCP runtime", () => {
  const definitions: AgentToolDefinition[] = [];
  registerAgentToolDefinitions({ register: (definition) => definitions.push(definition) }, fakeClient([]));

  assert.deepEqual(definitions.map((definition) => definition.name), MCP_TOOL_NAMES);
  for (const definition of definitions) {
    assert.deepEqual(definition.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  }
});

test("maps MCP tool names and validated inputs onto SDK calls", async () => {
  const calls: Array<{ tool: AgentToolName; input: unknown }> = [];
  const definitions: AgentToolDefinition[] = [];
  registerAgentToolDefinitions({ register: (definition) => definitions.push(definition) }, fakeClient(calls));

  const replies = definitions.find((definition) => definition.name === "replies_list");
  const timeline = definitions.find((definition) => definition.name === "company_timeline");
  assert.ok(replies);
  assert.ok(timeline);

  await replies.call({ campaignId: "campaign_123", limit: 4, query: "Visio" });
  await timeline.call({ campaignId: "campaign_123", companyOutreachId: "outreach_456" });

  assert.deepEqual(calls, [
    {
      tool: "replies.list",
      input: { campaignId: "campaign_123", limit: 4, query: "Visio" },
    },
    {
      tool: "company.timeline",
      input: { campaignId: "campaign_123", companyOutreachId: "outreach_456" },
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
