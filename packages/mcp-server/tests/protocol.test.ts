import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import test from "node:test";

import type {
  AgentToolInputMap,
  AgentToolName,
  AgentToolResult,
} from "@dmfaster/sdk";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { MCP_SERVER_INSTRUCTIONS, serveDmfasterStdio } from "../src/server.ts";
import { MCP_TOOL_NAMES, type AgentInvoker } from "../src/tools.ts";
import {
  CAMPAIGN_WORKSPACE_RESOURCE_URI,
  MCP_APP_RESOURCE_MIME_TYPE,
} from "../src/campaign-workspace.ts";

type JsonObject = Record<string, unknown>;

function result(tool: AgentToolName): AgentToolResult {
  return {
    version: 1,
    tool,
    policy: { effect: "read", approval: "none", exposure: "public_api" },
    ok: true,
    generatedAt: "2026-08-02T12:00:00.000Z",
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

function createWire(client: AgentInvoker) {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = createInterface({ input: output, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  const handle = serveDmfasterStdio(client, {
    transport: new StdioServerTransport(input, output),
  });

  return {
    send(message: JsonObject) {
      input.write(`${JSON.stringify(message)}\n`);
    },
    async receive(): Promise<JsonObject> {
      const next = await iterator.next();
      assert.equal(next.done, false, "MCP transport closed before sending a response");
      return JSON.parse(next.value) as JsonObject;
    },
    async close() {
      lines.close();
      await handle.close();
    },
  };
}

const modernEnvelope = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "dmfaster-test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

const campaignState = {
  profile: {
    version: 1 as const,
    businessName: "Example Analytics",
    websiteUrl: "https://example.test",
    businessDescription: "Revenue analytics for B2B software companies.",
    offer: "A revenue analytics workspace",
    customerOutcome: "Find pipeline gaps and improve conversion.",
    differentiators: ["Fast setup"],
    proofPoints: ["Used by revenue teams"],
    preferredTone: "Direct and useful",
    preferredLanguages: ["English"],
    defaultCountries: ["FI" as const],
    excludedCompanyTraits: [],
  },
  brief: {
    version: 1 as const,
    objective: "Book a discovery call",
    offer: "A revenue analytics workspace",
    targetDescription: "Finnish B2B software companies",
    countries: ["FI" as const],
    industryCodes: ["62010"],
    decisionMakerRoles: ["Head of Sales"],
    companySize: {
      employeeMin: 10,
      employeeMax: 250,
      revenueMinEur: null,
      revenueMaxEur: null,
    },
    requestedSignals: [],
    exclusions: [],
    callToAction: "Open to a 15-minute review?",
    requestedChannels: ["instagram" as const],
    messageLanguage: "English",
    tone: "Direct and useful",
    dailyVolume: 20,
    deliverySettings: {
      dailyCap: 20,
      windowStart: "09:00",
      windowEnd: "16:00",
      weekdays: 31,
      timezone: "Europe/Helsinki",
      confirmed: true,
    },
    outreachMessages: [{
      channels: ["instagram" as const],
      subject: "",
      body: "Hi — would a quick revenue pipeline review be useful?",
      origin: "user" as const,
    }],
  },
};

test("serves the stateless MCP 2026-07-28 protocol over stdio", async (context) => {
  const calls: Array<{ tool: AgentToolName; input: unknown }> = [];
  const wire = createWire(fakeClient(calls));
  context.after(() => wire.close());

  wire.send({
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: { _meta: modernEnvelope },
  });
  const discover = await wire.receive();
  assert.deepEqual(
    (discover.result as JsonObject).supportedVersions,
    ["2026-07-28"],
  );
  assert.equal(
    (discover.result as JsonObject).instructions,
    MCP_SERVER_INSTRUCTIONS,
  );

  wire.send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: { _meta: modernEnvelope },
  });
  const listed = await wire.receive();
  const tools = (listed.result as JsonObject).tools as Array<JsonObject>;
  assert.deepEqual(tools.map((tool) => tool.name), MCP_TOOL_NAMES);
  const workspaceTool = tools.find((tool) => tool.name === "campaign_workspace");
  assert.ok(workspaceTool);
  assert.equal(
    ((workspaceTool._meta as JsonObject).ui as JsonObject).resourceUri,
    CAMPAIGN_WORKSPACE_RESOURCE_URI,
  );
  assert.equal(
    (workspaceTool._meta as JsonObject)["openai/outputTemplate"],
    CAMPAIGN_WORKSPACE_RESOURCE_URI,
  );

  wire.send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "workspace_briefing",
      arguments: {},
      _meta: modernEnvelope,
    },
  });
  const called = await wire.receive();
  assert.equal((called.result as JsonObject).isError, undefined);
  assert.deepEqual(calls, [{ tool: "workspace.briefing", input: {} }]);

  wire.send({
    jsonrpc: "2.0",
    id: 4,
    method: "resources/list",
    params: { _meta: modernEnvelope },
  });
  const resourcesResponse = await wire.receive();
  const resources = (resourcesResponse.result as JsonObject).resources as Array<JsonObject>;
  assert.deepEqual(resources.map((resource) => resource.uri), [CAMPAIGN_WORKSPACE_RESOURCE_URI]);
  assert.equal(resources[0]?.mimeType, MCP_APP_RESOURCE_MIME_TYPE);

  wire.send({
    jsonrpc: "2.0",
    id: 5,
    method: "resources/read",
    params: { uri: CAMPAIGN_WORKSPACE_RESOURCE_URI, _meta: modernEnvelope },
  });
  const resourceResponse = await wire.receive();
  const contents = (resourceResponse.result as JsonObject).contents as Array<JsonObject>;
  assert.equal(contents[0]?.mimeType, MCP_APP_RESOURCE_MIME_TYPE);
  assert.match(String(contents[0]?.text), /ui\/initialize/u);
  assert.match(String(contents[0]?.text), /campaign_prepare/u);

  wire.send({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "campaign_workspace",
      arguments: { state: campaignState },
      _meta: modernEnvelope,
    },
  });
  const presented = await wire.receive();
  const presentation = (presented.result as JsonObject).structuredContent as JsonObject;
  assert.equal(presentation.view, "dmfaster.campaign_workspace");
  assert.deepEqual(presentation.state, campaignState);
  assert.deepEqual(calls, [{ tool: "workspace.briefing", input: {} }]);
});

test("rejects the 2025 initialize flow and remains available for stateless MCP", async (context) => {
  const wire = createWire(fakeClient([]));
  context.after(() => wire.close());

  wire.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "dmfaster-legacy-test", version: "1.0.0" },
    },
  });
  const rejected = await wire.receive();
  assert.match(
    String((rejected.error as JsonObject).message),
    /unsupported protocol version/i,
  );
  assert.deepEqual(
    ((rejected.error as JsonObject).data as JsonObject).supported,
    ["2026-07-28"],
  );

  wire.send({
    jsonrpc: "2.0",
    id: 2,
    method: "server/discover",
    params: { _meta: modernEnvelope },
  });
  const discovered = await wire.receive();
  assert.deepEqual(
    (discovered.result as JsonObject).supportedVersions,
    ["2026-07-28"],
  );
});
