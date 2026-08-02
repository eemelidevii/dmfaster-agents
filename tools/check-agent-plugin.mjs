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
const cursorManifest = readJson("plugins/dmfaster/.cursor-plugin/plugin.json");
const sharedMcp = readJson("plugins/dmfaster/.mcp.json");

for (const [host, manifest] of [
  ["Codex", codexManifest],
  ["Claude", claudeManifest],
  ["Cursor", cursorManifest],
]) {
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
if (cursorManifest.mcpServers !== "./.mcp.json") {
  fail("Cursor manifest must use the shared MCP config");
}
if (JSON.stringify(codexManifest.interface?.capabilities) !== JSON.stringify(["Read", "Write"])) {
  fail("Codex manifest must advertise the Agent 1.0 Read and Write capabilities");
}
if (cursorManifest.displayName !== "DM Faster") {
  fail("Cursor manifest displayName must be DM Faster");
}
if (cursorManifest.logo !== "assets/dm-icon.png") {
  fail("Cursor manifest must use the approved repository-hosted logo");
}
if (cursorManifest.category !== "productivity") {
  fail("Cursor manifest category must be productivity");
}
if (JSON.stringify(cursorManifest.author) !== JSON.stringify({ name: "DM Faster" })) {
  fail("Cursor manifest author must match its schema-safe DM Faster metadata");
}

const cursorAllowedKeys = new Set([
  "name",
  "displayName",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "logo",
  "keywords",
  "category",
  "tags",
  "skills",
  "mcpServers",
]);
for (const key of Object.keys(cursorManifest)) {
  if (!cursorAllowedKeys.has(key)) fail(`Cursor manifest contains unsupported property ${key}`);
}
if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/u.test(cursorManifest.name ?? "")) {
  fail("Cursor manifest name must match Cursor's lowercase plugin identifier format");
}
if (!/^\d+\.\d+\.\d+$/u.test(cursorManifest.version ?? "")) {
  fail("Cursor manifest version must be a stable semantic version");
}
for (const key of ["description", "homepage", "repository", "license"]) {
  if (typeof cursorManifest[key] !== "string" || cursorManifest[key].length === 0) {
    fail(`Cursor manifest ${key} must be a non-empty string`);
  }
}
for (const key of ["keywords", "tags"]) {
  if (!Array.isArray(cursorManifest[key]) || cursorManifest[key].some((value) => typeof value !== "string")) {
    fail(`Cursor manifest ${key} must be an array of strings`);
  }
}
const cursorLogo = path.resolve(pluginRoot, cursorManifest.logo ?? "");
if (!cursorLogo.startsWith(`${pluginRoot}${path.sep}`) || !existsSync(cursorLogo)) {
  fail("Cursor manifest logo must resolve inside the plugin directory");
}

const expectedPackage = `@dmfaster/mcp-server@${releaseVersion}`;
const sharedServer = sharedMcp.mcpServers?.dmfaster;
const expectedMcpConfig = {
  mcpServers: {
    dmfaster: {
      command: "npx",
      args: ["--yes", expectedPackage],
    },
  },
};
if (JSON.stringify(sharedMcp) !== JSON.stringify(expectedMcpConfig)) {
  fail("shared MCP config must contain only the version-pinned dmfaster stdio server");
}
for (const [host, server] of [
  ["Codex", sharedServer],
  ["Claude", sharedServer],
  ["Cursor", sharedServer],
]) {
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
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  "assets/dm-icon.png",
  "skills/dmfaster/SKILL.md",
  "skills/dmfaster/agents/openai.yaml",
  "skills/dmfaster/references/authentication.md",
  "skills/dmfaster/references/tools.md",
];
for (const relativePath of requiredFiles) {
  if (!existsSync(path.join(pluginRoot, relativePath))) fail(`missing plugin file ${relativePath}`);
}

const publicMarketplacePaths = [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
];
const publicMarketplacePresence = publicMarketplacePaths.map((relativePath) => (
  existsSync(path.join(repoRoot, relativePath))
));
if (publicMarketplacePresence.some(Boolean) && !publicMarketplacePresence.every(Boolean)) {
  fail("public releases must register the plugin in Codex, Claude, and Cursor marketplaces together");
}
if (publicMarketplacePresence.every(Boolean)) {
  const cursorMarketplace = readJson(".cursor-plugin/marketplace.json");
  const cursorMarketplaceAllowedKeys = new Set(["name", "owner", "metadata", "plugins"]);
  for (const key of Object.keys(cursorMarketplace)) {
    if (!cursorMarketplaceAllowedKeys.has(key)) {
      fail(`Cursor marketplace contains unsupported property ${key}`);
    }
  }
  if (cursorMarketplace.name !== "dmfaster-agents") {
    fail("Cursor marketplace name must be dmfaster-agents");
  }
  if (JSON.stringify(cursorMarketplace.owner) !== JSON.stringify({ name: "DM Faster" })) {
    fail("Cursor marketplace owner must be DM Faster without a personal contact address");
  }
  if (typeof cursorMarketplace.metadata?.description !== "string") {
    fail("Cursor marketplace must include a description");
  }
  const cursorEntries = cursorMarketplace.plugins;
  if (!Array.isArray(cursorEntries) || cursorEntries.length !== 1) {
    fail("Cursor marketplace must contain exactly one plugin");
  } else {
    const [entry] = cursorEntries;
    const entryAllowedKeys = new Set(["name", "source", "description"]);
    for (const key of Object.keys(entry)) {
      if (!entryAllowedKeys.has(key)) fail(`Cursor marketplace entry contains unsupported property ${key}`);
    }
    if (entry.name !== cursorManifest.name) fail("Cursor marketplace and plugin names must match");
    if (entry.source !== "plugins/dmfaster") {
      fail("Cursor marketplace source must resolve to plugins/dmfaster");
    }
    if (entry.description !== cursorManifest.description) {
      fail("Cursor marketplace and plugin descriptions must match");
    }
  }
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
  process.stdout.write(`DM Faster Codex, Claude, and Cursor plugin structure is valid for ${releaseVersion}.\n`);
}
