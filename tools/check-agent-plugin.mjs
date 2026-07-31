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
const codexMarketplace = readJson(".agents/plugins/marketplace.json");
const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
const cursorMarketplace = readJson(".cursor-plugin/marketplace.json");

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
if (JSON.stringify(codexManifest.interface?.capabilities) !== JSON.stringify(["Read"])) {
  fail("Codex manifest must advertise only the Read capability");
}
if (codexManifest.interface?.composerIcon !== "./assets/dm-icon.png") {
  fail("Codex manifest must use the production DM Faster icon as its composer icon");
}
if (codexManifest.interface?.logo !== "./assets/dm-icon.png") {
  fail("Codex manifest must use the production DM Faster icon as its logo");
}
if (codexManifest.interface?.logoDark !== undefined) {
  fail("Codex manifest must not substitute a generated dark logo");
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

const expectedCodexMarketplace = {
  name: "dmfaster-agents",
  interface: {
    displayName: "DM Faster",
  },
  plugins: [
    {
      name: "dmfaster",
      source: {
        source: "local",
        path: "./plugins/dmfaster",
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL",
      },
      category: "Productivity",
    },
  ],
};
if (JSON.stringify(codexMarketplace) !== JSON.stringify(expectedCodexMarketplace)) {
  fail("Codex marketplace must expose only the canonical dmfaster plugin");
}

if (claudeMarketplace.name !== "dmfaster-agents") {
  fail("Claude marketplace name must be dmfaster-agents");
}
if (claudeMarketplace.owner?.name !== "DM Faster") {
  fail("Claude marketplace owner must be DM Faster");
}
if (!Array.isArray(claudeMarketplace.plugins) || claudeMarketplace.plugins.length !== 1) {
  fail("Claude marketplace must expose exactly one plugin");
} else {
  const [plugin] = claudeMarketplace.plugins;
  if (plugin.name !== "dmfaster") fail("Claude marketplace plugin name must be dmfaster");
  if (plugin.source !== "./plugins/dmfaster") {
    fail("Claude marketplace must point to the canonical dmfaster plugin");
  }
  if (plugin.strict !== true) fail("Claude marketplace plugin must use strict mode");
}

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
if (!Array.isArray(cursorMarketplace.plugins) || cursorMarketplace.plugins.length !== 1) {
  fail("Cursor marketplace must contain exactly one plugin");
} else {
  const [entry] = cursorMarketplace.plugins;
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

const requiredFiles = [
  "LICENSE",
  "README.md",
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  "skills/dmfaster/SKILL.md",
  "skills/dmfaster/agents/openai.yaml",
  "skills/dmfaster/references/authentication.md",
  "skills/dmfaster/references/tools.md",
  "assets/dm-icon.png",
];
for (const relativePath of requiredFiles) {
  if (!existsSync(path.join(pluginRoot, relativePath))) fail(`missing plugin file ${relativePath}`);
}

const publicReadme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
const requiredInstallCommands = [
  "codex plugin marketplace add eemelidevii/dmfaster-agents",
  "codex plugin add dmfaster@dmfaster-agents",
  "claude plugin marketplace add eemelidevii/dmfaster-agents",
  "claude plugin install dmfaster@dmfaster-agents",
  "/add-plugin dmfaster",
];
for (const command of requiredInstallCommands) {
  if (!publicReadme.includes(command)) fail(`README.md must document \`${command}\``);
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
