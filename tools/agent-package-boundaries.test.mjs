import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.join(repoRoot, "packages");
const runtimePackages = ["local-auth", "sdk", "cli", "mcp-server"];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  }));
  return nested.flat();
}

async function combinedSource(packageName) {
  const files = await sourceFiles(path.join(packagesRoot, packageName, "src"));
  return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
}

test("agent runtime packages do not import application or execution internals", async () => {
  for (const packageName of runtimePackages) {
    const source = await combinedSource(packageName);
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()["'][^"']*(?:site\/src|@\/|next\/|drizzle|postgres)/u);
    assert.doesNotMatch(source, /wtoken_|dmf_session|worker-protocol|claimJobs|submitOutcome/u);
  }
});

test("CLI and MCP delegate network calls to the SDK", async () => {
  for (const packageName of ["cli", "mcp-server"]) {
    const source = await combinedSource(packageName);
    assert.match(source, /@dmfaster\/sdk/u);
    assert.doesNotMatch(source, /\bfetch\s*\(/u);
  }
});

test("Agent 1.0 adapters expose only narrow idempotent and authorized actions", async () => {
  const source = `${await combinedSource("cli")}\n${await combinedSource("mcp-server")}`;
  assert.doesNotMatch(
    source,
    /reply[._]send|meeting[._]book|list[._](?:create|update|delete)|campaign[._](?:delete|stop)|\b(?:sql|query_database|execute_generic)\b|approved\s*:/iu,
  );
  assert.match(source, /readOnlyHint:\s*true/u);
  assert.match(source, /destructiveHint:\s*false/u);
  assert.match(source, /destructiveHint:\s*true/u);
  assert.match(source, /campaign_launch_preflight/u);
  assert.match(source, /campaign_launch/u);
  assert.match(source, /campaign_pause_preflight/u);
  assert.match(source, /campaign_pause/u);
  assert.match(source, /idempotencyKey/u);
  assert.match(source, /authorizationId/u);
});

test("the root workspace owns the only lockfile for agent packages", async () => {
  for (const packageName of runtimePackages) {
    const entries = await readdir(path.join(packagesRoot, packageName));
    assert.equal(entries.includes("package-lock.json"), false, `${packageName} has a nested lockfile`);
  }
});
