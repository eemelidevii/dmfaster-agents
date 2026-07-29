#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDefinitions = [
  { directory: "local-auth", name: "@dmfaster/local-auth" },
  { directory: "sdk", name: "@dmfaster/sdk" },
  { directory: "cli", name: "@dmfaster/cli" },
  { directory: "mcp-server", name: "@dmfaster/mcp-server" },
];
const internalPackages = new Set(packageDefinitions.map(({ name }) => name));

function readPackage(directory) {
  return JSON.parse(readFileSync(path.join(repoRoot, "packages", directory, "package.json"), "utf8"));
}

const releaseVersion = readPackage(packageDefinitions[0].directory).version;
if (typeof releaseVersion !== "string" || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(releaseVersion)) {
  throw new Error(`Agent packages must use one stable semantic version; received ${String(releaseVersion)}.`);
}

for (const { directory, name } of packageDefinitions) {
  const packageJson = readPackage(directory);
  if (packageJson.name !== name) throw new Error(`${directory} must publish as ${name}.`);
  if (packageJson.version !== releaseVersion) {
    throw new Error(`${name} must use the aligned release version ${releaseVersion}.`);
  }
  if (Object.hasOwn(packageJson, "private")) {
    throw new Error(`${name} must not contain the private field.`);
  }
  if (packageJson.license !== "Apache-2.0") {
    throw new Error(`${name} must declare the approved Apache-2.0 license.`);
  }
  if (packageJson.author !== "DM Faster" || packageJson.homepage !== "https://dmfaster.com") {
    throw new Error(`${name} is missing the canonical DM Faster author or homepage metadata.`);
  }
  if (
    packageJson.repository?.type !== "git"
    || packageJson.repository?.url !== "git+https://github.com/eemelidevii/dmfaster-agents.git"
    || packageJson.repository?.directory !== `packages/${directory}`
  ) {
    throw new Error(`${name} is missing its canonical repository metadata.`);
  }
  if (packageJson.engines?.node !== "24.x") {
    throw new Error(`${name} must require Node.js 24.x.`);
  }
  if (packageJson.publishConfig?.access !== "public" || packageJson.publishConfig?.provenance !== true) {
    throw new Error(`${name} must require public npm access with provenance.`);
  }

  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [dependency, version] of Object.entries(packageJson[section] || {})) {
      if (/^(?:file|link|workspace):/u.test(String(version))) {
        throw new Error(`${name} uses a non-publishable ${section} specifier for ${dependency}: ${version}`);
      }
      if (internalPackages.has(dependency) && version !== releaseVersion) {
        throw new Error(`${name} must depend on ${dependency} at exactly ${releaseVersion}.`);
      }
    }
  }
}

const versionSources = [
  ["packages/cli/src/cli.ts", `export const CLI_VERSION = "${releaseVersion}";`],
  ["packages/mcp-server/src/server.ts", `export const MCP_SERVER_VERSION = "${releaseVersion}";`],
];
for (const [relativePath, expectedSource] of versionSources) {
  const source = readFileSync(path.join(repoRoot, relativePath), "utf8");
  if (!source.includes(expectedSource)) {
    throw new Error(`${relativePath} must expose the aligned release version ${releaseVersion}.`);
  }
}

for (const { name: packageName } of packageDefinitions) {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--workspace", packageName], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Unable to inspect ${packageName}.`);
  }
  const report = JSON.parse(result.stdout)[0];
  if (!report || !Array.isArray(report.files)) throw new Error(`npm returned no package report for ${packageName}.`);
  if (report.name !== packageName || report.version !== releaseVersion) {
    throw new Error(`npm would pack an unexpected identity for ${packageName}.`);
  }
  const publishedPaths = new Set(report.files.map((file) => String(file.path || "")));
  if (
    !publishedPaths.has("package.json")
    || !publishedPaths.has("README.md")
    || !publishedPaths.has("LICENSE")
  ) {
    throw new Error(`${packageName} must publish package.json, README.md, and LICENSE.`);
  }
  if (![...publishedPaths].some((packagePath) => packagePath.startsWith("dist/"))) {
    throw new Error(`${packageName} has no compiled dist files to publish.`);
  }
  for (const file of report.files) {
    const packagePath = String(file.path || "");
    if (!/^(?:LICENSE|README\.md|package\.json|dist\/)/u.test(packagePath)) {
      throw new Error(`${packageName} would publish an unexpected file: ${packagePath}`);
    }
    if (packagePath.startsWith("dist/src/") || /(?:^|\/)\.env(?:\.|$)/u.test(packagePath)) {
      throw new Error(`${packageName} would publish forbidden or stale content: ${packagePath}`);
    }
  }
  process.stdout.write(`${packageName}@${releaseVersion} is aligned, package-clean, and configured for public publishing.\n`);
}
