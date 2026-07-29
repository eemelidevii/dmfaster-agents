#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageNames = [
  "@dmfaster/local-auth",
  "@dmfaster/sdk",
  "@dmfaster/cli",
  "@dmfaster/mcp-server",
];
const releaseVersion = JSON.parse(
  readFileSync(path.join(repoRoot, "packages", "local-auth", "package.json"), "utf8"),
).version;
const expectedTools = [
  "campaign_inspect",
  "campaigns_list",
  "company_timeline",
  "pipeline_inspect",
  "replies_list",
  "sending_inspect",
  "workspace_briefing",
];
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "dmfaster-agent-packages-"));
const artifactDirectory = path.join(temporaryRoot, "artifacts");
const projectDirectory = path.join(temporaryRoot, "consumer");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env: options.env || process.env,
    timeout: options.timeout || 120_000,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with exit code ${result.status}.`,
        result.stdout.trim(),
        result.stderr.trim(),
      ].filter(Boolean).join("\n"),
    );
  }
  return result;
}

try {
  mkdirSync(artifactDirectory);
  mkdirSync(projectDirectory);
  writeFileSync(
    path.join(projectDirectory, "package.json"),
    `${JSON.stringify({ name: "dmfaster-packed-install-smoke", private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );

  const tarballs = [];
  for (const packageName of packageNames) {
    const result = run("npm", [
      "pack",
      "--json",
      "--workspace",
      packageName,
      "--pack-destination",
      artifactDirectory,
    ]);
    const report = JSON.parse(result.stdout)[0];
    assert.ok(report?.filename, `npm pack did not return an artifact for ${packageName}`);
    tarballs.push(path.join(artifactDirectory, report.filename));
  }

  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    ...tarballs,
  ], { cwd: projectDirectory });

  for (const packageName of packageNames) {
    const installedManifest = JSON.parse(
      readFileSync(path.join(projectDirectory, "node_modules", ...packageName.split("/"), "package.json"), "utf8"),
    );
    assert.equal(installedManifest.version, releaseVersion, `${packageName} installed at an unexpected version`);
  }

  const cli = path.join(projectDirectory, "node_modules", ".bin", "dmfaster");
  const help = run(cli, ["--help"], { cwd: projectDirectory });
  assert.ok(help.stdout.includes(`DM Faster CLI ${releaseVersion}`));
  assert.match(help.stdout, /All agent tools are read-only\./u);

  const requireFromConsumer = createRequire(path.join(projectDirectory, "package.json"));
  const clientModule = await import(pathToFileURL(
    requireFromConsumer.resolve("@modelcontextprotocol/sdk/client/index.js"),
  ).href);
  const transportModule = await import(pathToFileURL(
    requireFromConsumer.resolve("@modelcontextprotocol/sdk/client/stdio.js"),
  ).href);
  const mcpServerBinary = path.join(
    projectDirectory,
    "node_modules",
    "@dmfaster",
    "mcp-server",
    "dist",
    "bin.js",
  );
  const client = new clientModule.Client({ name: "packed-install-smoke", version: releaseVersion });
  const transport = new transportModule.StdioClientTransport({
    command: process.execPath,
    args: [mcpServerBinary],
    env: {
      ...process.env,
      DMFASTER_API_URL: "http://127.0.0.1:9",
      DMFASTER_TOKEN: `dmf_pat_${"0".repeat(64)}`,
    },
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      expectedTools,
      "the packed MCP server must expose exactly the seven approved tools",
    );
  } finally {
    await client.close();
  }

  process.stdout.write(
    "Packed SDK, auth, CLI, and MCP artifacts install cleanly; CLI help and all seven offline MCP tools passed.\n",
  );
} finally {
  const expectedPrefix = path.join(tmpdir(), "dmfaster-agent-packages-");
  if (!temporaryRoot.startsWith(expectedPrefix)) {
    throw new Error(`Refusing to clean an unexpected temporary path: ${temporaryRoot}`);
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}
