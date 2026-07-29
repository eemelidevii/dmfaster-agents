#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repoRoot, "plugins", "dmfaster");
const packagePaths = [
  "packages/local-auth/package.json",
  "packages/sdk/package.json",
  "packages/cli/package.json",
  "packages/mcp-server/package.json",
];

function fail(message) {
  process.stderr.write(`DM Faster plugin check failed: ${message}\n`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`missing ${relativePath}`);
    return {};
  }
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

const packageVersions = new Set(packagePaths.map((packagePath) => readJson(packagePath).version));
if (packageVersions.size !== 1 || packageVersions.has(undefined)) {
  fail("all four agent packages must use one exact version");
}
const [releaseVersion] = packageVersions;

const codexManifest = readJson("plugins/dmfaster/.codex-plugin/plugin.json");
const claudeManifest = readJson("plugins/dmfaster/.claude-plugin/plugin.json");
const codexMcp = readJson("plugins/dmfaster/.mcp.json");

for (const [host, manifest] of [["Codex", codexManifest], ["Claude", claudeManifest]]) {
  if (manifest.name !== "dmfaster") fail(`${host} manifest name must be dmfaster`);
  if (manifest.version !== releaseVersion) fail(`${host} manifest version must match agent packages`);
  if (manifest.license !== "Apache-2.0") fail(`${host} manifest must declare Apache-2.0`);
  if (manifest.repository !== "https://github.com/eemelidevii/dmfaster-agents") {
    fail(`${host} manifest must link to the approved public agent source`);
  }
  if (manifest.skills !== "./skills/") fail(`${host} manifest must use the canonical skills directory`);
}

if (codexManifest.mcpServers !== "./.mcp.json") {
  fail("Codex manifest must use the shared MCP config");
}
if (claudeManifest.mcpServers !== "./.mcp.json") {
  fail("Claude manifest must use the shared MCP config");
}
if (JSON.stringify(codexManifest.interface?.capabilities) !== JSON.stringify(["Read"])) {
  fail("Codex manifest must advertise only the Read capability");
}

const expectedPackage = `@dmfaster/mcp-server@${releaseVersion}`;
const sharedServer = codexMcp.mcpServers?.dmfaster;
const expectedMcpConfig = {
  mcpServers: {
    dmfaster: {
      command: "npx",
      args: ["--yes", expectedPackage],
    },
  },
};
if (JSON.stringify(codexMcp) !== JSON.stringify(expectedMcpConfig)) {
  fail("shared MCP config must contain only the version-pinned dmfaster stdio server");
}
for (const [host, server] of [["Codex", sharedServer], ["Claude", sharedServer]]) {
  if (server?.command !== "npx") fail(`${host} MCP server must launch through npx`);
  if (JSON.stringify(server?.args) !== JSON.stringify(["--yes", expectedPackage])) {
    fail(`${host} MCP server must pin ${expectedPackage}`);
  }
  const serialized = JSON.stringify(server ?? {});
  if (/latest|file:|link:|workspace:|DMFASTER_TOKEN/i.test(serialized)) {
    fail(`${host} MCP config contains an unsafe or unpinned value`);
  }
}

const requiredFiles = [
  "LICENSE",
  "README.md",
  "skills/dmfaster/SKILL.md",
  "skills/dmfaster/agents/openai.yaml",
  "skills/dmfaster/references/authentication.md",
  "skills/dmfaster/references/tools.md",
];
for (const relativePath of requiredFiles) {
  if (!existsSync(path.join(pluginRoot, relativePath))) fail(`missing plugin file ${relativePath}`);
}

const versionPinnedFiles = [
  "packages/local-auth/README.md",
  "packages/sdk/README.md",
  "packages/cli/README.md",
  "packages/mcp-server/README.md",
  "plugins/dmfaster/README.md",
  "plugins/dmfaster/skills/dmfaster/references/authentication.md",
  "plugins/dmfaster/skills/dmfaster/references/tools.md",
];
for (const relativePath of versionPinnedFiles) {
  const source = readFileSync(path.join(repoRoot, relativePath), "utf8");
  const pins = [...source.matchAll(/@dmfaster\/(?:local-auth|sdk|cli|mcp-server)@(\d+\.\d+\.\d+)/gu)];
  if (pins.length === 0) fail(`${relativePath} must contain an explicit @dmfaster package version`);
  for (const pin of pins) {
    if (pin[1] !== releaseVersion) {
      fail(`${relativePath} pins @dmfaster package version ${pin[1]}, not ${releaseVersion}`);
    }
  }
}

if (!process.exitCode) {
  process.stdout.write(`DM Faster Codex and Claude plugin structure is valid for ${releaseVersion}.\n`);
}
