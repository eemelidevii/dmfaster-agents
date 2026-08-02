import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(rootDir, "packages", "public-api", "openapi.yaml");
const packagePath = path.join(rootDir, "package.json");
const generatorPath = path.join(rootDir, "tools", "generate-public-api.mjs");
const sdkContractsPath = path.join(rootDir, "packages", "sdk", "src", "contracts.ts");
const mcpToolsPath = path.join(rootDir, "packages", "mcp-server", "src", "tools.ts");
const localAuthConstantsPath = path.join(rootDir, "packages", "local-auth", "src", "constants.ts");

const EXPECTED_TOOLS = new Map([
  ["workspace.briefing", { effect: "read", scopes: ["workspace:read"] }],
  ["campaigns.list", { effect: "read", scopes: ["campaigns:read"] }],
  ["campaign.inspect", { effect: "read", scopes: ["campaigns:read"] }],
  ["sending.inspect", { effect: "read", scopes: ["sending:read"] }],
  ["replies.list", { effect: "read", scopes: ["inbox:read"] }],
  ["pipeline.inspect", { effect: "read", scopes: ["pipeline:read"] }],
  ["company.timeline", { effect: "read", scopes: ["campaigns:read", "pipeline:read"] }],
  ["industry.lookup", { effect: "read", scopes: ["audiences:read"] }],
  ["campaign.validate", { effect: "read", scopes: ["audiences:read"] }],
  ["audience.preview", { effect: "read", scopes: ["audiences:read"] }],
  ["list.prepare", { effect: "draft", scopes: ["audiences:read", "campaigns:write"] }],
  ["campaign.prepare", { effect: "draft", scopes: ["audiences:read", "campaigns:write"] }],
  ["campaign.launch.preflight", { effect: "write", scopes: ["campaigns:launch"] }],
  ["campaign.launch", { effect: "external", scopes: ["campaigns:launch"] }],
  ["campaign.pause.preflight", { effect: "write", scopes: ["campaigns:write"] }],
  ["campaign.pause", { effect: "write", scopes: ["campaigns:write"] }],
]);

const EXPECTED_AUTH_METHODS = new Map([
  ["device", "post"],
  ["token", "post"],
  ["status", "get"],
  ["revoke", "post"],
]);
const EXPECTED_TOOL_NAMES = [...EXPECTED_TOOLS.keys()];
const EXPECTED_SCOPE_NAMES = [
  ...new Set([...EXPECTED_TOOLS.values()].flatMap(({ scopes }) => scopes)),
];

function sourceSlice(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function quotedValues(source) {
  return [...source.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
}

function yamlEnumValues(source, schemaName, nextSchemaName) {
  return sourceSlice(source, `    ${schemaName}:`, `    ${nextSchemaName}:`)
    .split("\n")
    .map((line) => line.match(/^        - (.+)$/)?.[1]?.trim())
    .filter(Boolean);
}

test("public API generation scripts and stale-output guidance share one repair command", async () => {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const generator = await readFile(generatorPath, "utf8");

  assert.equal(packageJson.scripts?.["generate:agent-api"], "node tools/generate-public-api.mjs");
  assert.equal(packageJson.scripts?.["check:agent-api"], "node tools/generate-public-api.mjs --check");
  assert.match(generator, /npm run generate:agent-api/);
  assert.doesNotMatch(generator, /npm run generate:public-api/);
});

function operationBlocks(source) {
  return [...source.matchAll(
    /^  \/api\/v1\/agent\/tools\/([^:]+):\n([\s\S]*?)(?=^  \/api\/v1\/agent\/tools\/|^components:)/gm,
  )].map((match) => ({ tool: match[1], source: match[2] }));
}

function authOperationBlocks(source) {
  return [...source.matchAll(
    /^  \/api\/v1\/agent\/auth\/([^:]+):\n([\s\S]*?)(?=^  \/api\/v1\/agent\/(?:auth|tools)\/|^components:)/gm,
  )].map((match) => ({ operation: match[1], source: match[2] }));
}

test("the Agent API exposes the bounded browser-login lifecycle", async () => {
  const source = await readFile(contractPath, "utf8");
  const blocks = authOperationBlocks(source);

  assert.deepEqual(blocks.map(({ operation }) => operation), [...EXPECTED_AUTH_METHODS.keys()]);
  for (const { operation, source: block } of blocks) {
    const methods = [...block.matchAll(/^    (get|post|put|patch|delete|options|head|trace):/gm)]
      .map((match) => match[1]);
    assert.deepEqual(methods, [EXPECTED_AUTH_METHODS.get(operation)]);
  }

  for (const operation of ["device", "token"]) {
    const block = blocks.find((candidate) => candidate.operation === operation)?.source || "";
    assert.match(block, /^      security: \[\]$/m, `${operation} must not require a bearer token`);
  }
  for (const operation of ["status", "revoke"]) {
    const block = blocks.find((candidate) => candidate.operation === operation)?.source || "";
    assert.doesNotMatch(block, /^      security: \[\]$/m, `${operation} must inherit bearer authentication`);
  }

  assert.match(source, /^        codeChallengeMethod:\n          type: string\n          const: S256$/m);
  assert.match(source, /^        expiresIn:\n          type: integer\n          const: 300$/m);
  assert.match(source, /pattern: '\^dmf_pat_\[a-f0-9\]\{64\}\$'/);
});

test("the public Agent API exposes exactly the approved Agent 1.0 operations", async () => {
  const source = await readFile(contractPath, "utf8");
  const blocks = operationBlocks(source);

  assert.deepEqual(blocks.map(({ tool }) => tool), [...EXPECTED_TOOLS.keys()]);
  for (const { tool, source: operation } of blocks) {
    const methods = [...operation.matchAll(/^    (get|post|put|patch|delete|options|head|trace):/gm)]
      .map((match) => match[1]);
    assert.deepEqual(methods, ["post"], `${tool} must expose only POST`);
    assert.match(
      operation,
      new RegExp(`^      x-dmfaster-effect: ${EXPECTED_TOOLS.get(tool).effect}$`, "m"),
      `${tool} effect drift`,
    );

    const scopeLine = operation.match(/^      x-dmfaster-required-scopes: \[([^\]]+)]$/m);
    assert.ok(scopeLine, `${tool} must declare scopes`);
    const scopes = scopeLine[1].split(",").map((scope) => scope.trim().replaceAll('"', ""));
    assert.deepEqual(scopes, EXPECTED_TOOLS.get(tool).scopes, `${tool} scope drift`);
  }

  assert.doesNotMatch(source, /approved:\s*true/);
  assert.match(source, /human approval/i);
});

test("every public tool registry exactly matches the OpenAPI operations", async () => {
  const [contract, sdkContracts, mcpTools] = await Promise.all([
    readFile(contractPath, "utf8"),
    readFile(sdkContractsPath, "utf8"),
    readFile(mcpToolsPath, "utf8"),
  ]);

  const registries = new Map([
    ["OpenAPI AgentToolName", yamlEnumValues(contract, "AgentToolName", "AgentToolPolicy")],
    ["SDK AGENT_TOOL_NAMES", quotedValues(sourceSlice(
      sdkContracts,
      "export const AGENT_TOOL_NAMES = [",
      "] as const",
    ))],
    ["MCP SDK tool mappings", [...mcpTools.matchAll(/^\s+tool: "([^"]+)",$/gm)]
      .map((match) => match[1])],
  ]);

  for (const [name, tools] of registries) {
    assert.deepEqual(tools, EXPECTED_TOOL_NAMES, `${name} drifted from the public operations`);
  }
});

test("every public contract and client scope allowlist stays equal", async () => {
  const [contract, localAuth] = await Promise.all([
    readFile(contractPath, "utf8"),
    readFile(localAuthConstantsPath, "utf8"),
  ]);

  const runtimeAllowlists = new Map([
    ["OpenAPI AgentApiScope", yamlEnumValues(contract, "AgentApiScope", "AgentDeviceAuthorizationInput")],
    ["local-auth DMFASTER_AGENT_SCOPES", quotedValues(sourceSlice(
      localAuth,
      "export const DMFASTER_AGENT_SCOPES = [",
      "] as const",
    ))],
  ]);
  for (const [name, scopes] of runtimeAllowlists) {
    assert.deepEqual(scopes, EXPECTED_SCOPE_NAMES, `${name} scope drift`);
  }
});
