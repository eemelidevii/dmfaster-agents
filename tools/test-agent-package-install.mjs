#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
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
const mcpClientPackage = "@modelcontextprotocol/client@2.0.0";
const campaignWorkspaceUri = "ui://dmfaster/campaign-workspace/v1.html";
const mcpAppMimeType = "text/html;profile=mcp-app";
const releaseVersion = JSON.parse(
  readFileSync(path.join(repoRoot, "packages", "local-auth", "package.json"), "utf8"),
).version;
const expectedTools = [
  "audience_preview",
  "campaign_inspect",
  "campaign_launch",
  "campaign_launch_preflight",
  "campaign_pause",
  "campaign_pause_preflight",
  "campaign_prepare",
  "campaign_validate",
  "campaign_workspace",
  "campaigns_list",
  "company_timeline",
  "industry_lookup",
  "list_prepare",
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

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${command} ${args.join(" ")} timed out.`));
    }, options.timeout || 120_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (status !== 0) {
        reject(new Error([
          `${command} ${args.join(" ")} failed with exit code ${status}.`,
          stdout.trim(),
          stderr.trim(),
        ].filter(Boolean).join("\n")));
        return;
      }
      resolve({ status, stdout, stderr });
    });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
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
    mcpClientPackage,
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
  assert.match(help.stdout, /Human-approved campaign controls:/u);
  assert.match(help.stdout, /short-lived approval in DM Faster for one exact campaign version/u);

  const cliToken = `dmf_pat_${"1".repeat(64)}`;
  const cliRequests = [];
  const cliApi = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      cliRequests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        contentType: request.headers["content-type"],
        body,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        version: 1,
        tool: "workspace.briefing",
        policy: { effect: "read", approval: "none", exposure: "public_api" },
        ok: true,
        generatedAt: "2026-08-02T12:00:00.000Z",
        durationMs: 1,
        evidence: [],
        consistency: { status: "verified", checks: ["packed_cli_fallback"] },
        data: { summary: "Disposable packed CLI fallback passed." },
        artifacts: [],
        error: null,
      }));
    });
  });
  await listen(cliApi);
  try {
    const address = cliApi.address();
    assert.ok(address && typeof address === "object");
    const briefing = await runAsync(cli, ["--json", "workspace", "briefing"], {
      cwd: projectDirectory,
      env: {
        ...process.env,
        DMFASTER_API_URL: `http://127.0.0.1:${address.port}`,
        DMFASTER_TOKEN: cliToken,
      },
    });
    assert.equal(briefing.stderr, "");
    assert.doesNotMatch(`${briefing.stdout}${briefing.stderr}`, new RegExp(cliToken, "u"));
    const result = JSON.parse(briefing.stdout);
    assert.equal(result.tool, "workspace.briefing");
    assert.equal(result.ok, true);
    assert.deepEqual(cliRequests, [{
      method: "POST",
      url: "/api/v1/agent/tools/workspace.briefing",
      authorization: `Bearer ${cliToken}`,
      contentType: "application/json",
      body: "{}",
    }]);
  } finally {
    await close(cliApi);
  }

  const requireFromConsumer = createRequire(path.join(projectDirectory, "package.json"));
  const clientModule = await import(pathToFileURL(
    requireFromConsumer.resolve("@modelcontextprotocol/client"),
  ).href);
  const transportModule = await import(pathToFileURL(
    requireFromConsumer.resolve("@modelcontextprotocol/client/stdio"),
  ).href);
  const mcpServerBinary = path.join(
    projectDirectory,
    "node_modules",
    "@dmfaster",
    "mcp-server",
    "dist",
    "bin.js",
  );
  const client = new clientModule.Client(
    { name: "packed-install-smoke", version: releaseVersion },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
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
    assert.equal(
      client.getProtocolEra(),
      "modern",
      "the packed MCP server must negotiate the MCP 2026-07-28 protocol",
    );
    assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      expectedTools,
      "the packed MCP server must expose 16 Agent 1.0 domain tools and the campaign workspace",
    );
    const workspaceTool = listed.tools.find((tool) => tool.name === "campaign_workspace");
    assert.equal(workspaceTool?._meta?.ui?.resourceUri, campaignWorkspaceUri);
    assert.equal(workspaceTool?._meta?.["openai/outputTemplate"], campaignWorkspaceUri);

    const listedResources = await client.listResources();
    assert.deepEqual(
      listedResources.resources.map((resource) => resource.uri),
      [campaignWorkspaceUri],
      "the packed MCP server must expose its campaign workspace resource",
    );
    assert.equal(listedResources.resources[0]?.mimeType, mcpAppMimeType);
    const workspaceResource = await client.readResource({ uri: campaignWorkspaceUri });
    assert.equal(workspaceResource.contents[0]?.mimeType, mcpAppMimeType);
    assert.match(workspaceResource.contents[0]?.text || "", /ui\/initialize/u);
    assert.match(workspaceResource.contents[0]?.text || "", /campaign_launch_preflight/u);
  } finally {
    await client.close();
  }

  process.stdout.write(
    "Packed SDK, auth, CLI, and MCP artifacts install cleanly; CLI fallback briefing and MCP 2026-07-28 with 16 Agent 1.0 domain tools plus the campaign workspace passed.\n",
  );
} finally {
  const expectedPrefix = path.join(tmpdir(), "dmfaster-agent-packages-");
  if (!temporaryRoot.startsWith(expectedPrefix)) {
    throw new Error(`Refusing to clean an unexpected temporary path: ${temporaryRoot}`);
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}
