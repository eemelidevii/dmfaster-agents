import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(rootDir, "packages", "public-api", "openapi.yaml");

const EXPECTED_SCOPES = new Map([
  ["workspace.briefing", ["workspace:read"]],
  ["campaigns.list", ["campaigns:read"]],
  ["campaign.inspect", ["campaigns:read"]],
  ["sending.inspect", ["sending:read"]],
  ["replies.list", ["inbox:read"]],
  ["pipeline.inspect", ["pipeline:read"]],
  ["company.timeline", ["campaigns:read", "pipeline:read"]],
]);

const EXPECTED_AUTH_METHODS = new Map([
  ["device", "post"],
  ["token", "post"],
  ["status", "get"],
  ["revoke", "post"],
]);

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

test("the public Agent API exposes exactly the seven approved read-only operations", async () => {
  const source = await readFile(contractPath, "utf8");
  const blocks = operationBlocks(source);

  assert.deepEqual(blocks.map(({ tool }) => tool), [...EXPECTED_SCOPES.keys()]);
  for (const { tool, source: operation } of blocks) {
    const methods = [...operation.matchAll(/^    (get|post|put|patch|delete|options|head|trace):/gm)]
      .map((match) => match[1]);
    assert.deepEqual(methods, ["post"], `${tool} must expose only POST`);
    assert.match(operation, /^      x-dmfaster-effect: read$/m, `${tool} must remain read-only`);

    const scopeLine = operation.match(/^      x-dmfaster-required-scopes: \[([^\]]+)]$/m);
    assert.ok(scopeLine, `${tool} must declare scopes`);
    const scopes = scopeLine[1].split(",").map((scope) => scope.trim().replaceAll('"', ""));
    assert.deepEqual(scopes, EXPECTED_SCOPES.get(tool), `${tool} scope drift`);
  }
});
