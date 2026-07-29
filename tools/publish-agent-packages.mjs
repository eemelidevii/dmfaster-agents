#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const agentPackageDefinitions = [
  { directory: "local-auth", name: "@dmfaster/local-auth" },
  { directory: "sdk", name: "@dmfaster/sdk" },
  { directory: "cli", name: "@dmfaster/cli" },
  { directory: "mcp-server", name: "@dmfaster/mcp-server" },
];

function requireResult(result, description) {
  if (result.status !== 0) {
    throw new Error(
      [
        `${description} failed with exit code ${String(result.status)}.`,
        result.stdout?.trim(),
        result.stderr?.trim(),
      ].filter(Boolean).join("\n"),
    );
  }
  return result;
}

function parseJsonOutput(result, description) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${description} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function publishPackageSequence({
  definitions = agentPackageDefinitions,
  version,
  packPackage,
  getPublishedArtifact,
  publishPackage,
  beforePublish = () => {},
  write = (message) => process.stdout.write(message),
}) {
  const releasePlan = definitions.map((definition) => {
    const artifact = packPackage(definition);
    if (
      artifact?.name !== definition.name
      || artifact?.version !== version
      || typeof artifact?.integrity !== "string"
      || !artifact.integrity.startsWith("sha512-")
    ) {
      throw new Error(`${definition.name} produced an invalid release artifact.`);
    }

    const publishedArtifact = getPublishedArtifact(definition, version);
    if (publishedArtifact !== null) {
      if (publishedArtifact.integrity !== artifact.integrity) {
        throw new Error(
          `${definition.name}@${version} already exists with integrity ${publishedArtifact.integrity}, not ${artifact.integrity}.`,
        );
      }
      if (publishedArtifact.provenance !== true) {
        throw new Error(`${definition.name}@${version} exists without verified npm provenance metadata.`);
      }
      return { artifact, definition, alreadyPublished: true };
    }
    return { artifact, definition, alreadyPublished: false };
  });

  beforePublish();

  for (const { artifact, definition, alreadyPublished } of releasePlan) {
    if (alreadyPublished) {
      write(`Verified existing ${definition.name}@${version}; skipping immutable version.\n`);
      continue;
    }

    const publication = publishPackage(definition, artifact);
    if (
      publication?.name !== definition.name
      || publication?.version !== version
      || publication?.integrity !== artifact.integrity
    ) {
      throw new Error(`${definition.name}@${version} published without the expected artifact integrity.`);
    }
    write(`Published ${definition.name}@${version} with verified integrity.\n`);
  }
}

export function extractPublishedReport(payload, packageName) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const keyedReport = payload[packageName];
    if (keyedReport && typeof keyedReport === "object" && !Array.isArray(keyedReport)) return keyedReport;
    return payload;
  }
  return null;
}

function runNpm(args) {
  return spawnSync("npm", args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
}

function assertReleaseContext(version) {
  if (process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("Agent packages may only publish from the guarded GitHub Actions workflow.");
  }
  if (process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error(`Agent packages may only publish from main; received ${process.env.GITHUB_REF || "(missing)"}.`);
  }
  if (process.env.GITHUB_REPOSITORY_VISIBILITY !== "public") {
    throw new Error("Agent package provenance requires an approved public GitHub source repository.");
  }
  if (process.env.GITHUB_REPOSITORY !== "eemelidevii/dmfaster-agents") {
    throw new Error(
      `Agent packages may only publish from eemelidevii/dmfaster-agents; received ${process.env.GITHUB_REPOSITORY || "(missing)"}.`,
    );
  }
  const releaseWorkflow = process.env.DMFASTER_AGENT_RELEASE_WORKFLOW === "agent-packages-release.yml";
  const bootstrapWorkflow = (
    process.env.DMFASTER_AGENT_BOOTSTRAP_WORKFLOW === "agent-packages-bootstrap.yml"
  );
  if (releaseWorkflow === bootstrapWorkflow) {
    throw new Error("Exactly one guarded agent package workflow marker is required.");
  }
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version)) {
    throw new Error(`Agent package releases require a stable semantic version; received ${version || "(empty)"}.`);
  }

  const head = requireResult(
    spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }),
    "git rev-parse HEAD",
  ).stdout.trim();
  if (!process.env.GITHUB_SHA || head !== process.env.GITHUB_SHA) {
    throw new Error(`Release checkout ${head} does not match GITHUB_SHA ${process.env.GITHUB_SHA || "(missing)"}.`);
  }
  return bootstrapWorkflow ? "bootstrap" : "release";
}

function assertBootstrapExists(definition) {
  const result = runNpm(["view", definition.name, "name", "--json"]);
  if (result.status !== 0) {
    if (/\bE404\b|404 Not Found/u.test(`${result.stdout}\n${result.stderr}`)) {
      throw new Error(
        `${definition.name} has not completed its separately approved first-publish bootstrap; refusing OIDC release.`,
      );
    }
    requireResult(result, `npm view ${definition.name}`);
  }
  const publishedName = parseJsonOutput(result, `npm view ${definition.name}`);
  if (publishedName !== definition.name) {
    throw new Error(`npm returned an unexpected package identity for ${definition.name}.`);
  }
}

function assertBootstrapCandidate(definition, version) {
  const result = runNpm(["view", definition.name, "name", "--json"]);
  if (result.status !== 0) {
    if (/\bE404\b|404 Not Found/u.test(`${result.stdout}\n${result.stderr}`)) return;
    requireResult(result, `npm view ${definition.name}`);
  }
  const publishedName = parseJsonOutput(result, `npm view ${definition.name}`);
  if (publishedName !== definition.name) {
    throw new Error(`npm returned an unexpected package identity for ${definition.name}.`);
  }
  if (getPublishedArtifact(definition, version) === null) {
    throw new Error(
      `${definition.name} already exists but ${version} does not; refusing a first-publish bootstrap over an existing package.`,
    );
  }
}

function getPublishedArtifact(definition, version) {
  const result = runNpm(["view", `${definition.name}@${version}`, "dist", "--json"]);
  if (result.status !== 0) {
    if (/\bE404\b|404 Not Found/u.test(`${result.stdout}\n${result.stderr}`)) return null;
    requireResult(result, `npm view ${definition.name}@${version}`);
  }
  const distribution = parseJsonOutput(result, `npm view ${definition.name}@${version}`);
  const integrity = distribution?.integrity;
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) {
    throw new Error(`npm returned invalid integrity metadata for ${definition.name}@${version}.`);
  }
  return {
    integrity,
    provenance: distribution?.attestations?.provenance?.predicateType === "https://slsa.dev/provenance/v1",
  };
}

function assertCurrentMain() {
  requireResult(
    spawnSync(
      "git",
      ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"],
      { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
    ),
    "git fetch origin main",
  );
  const head = requireResult(
    spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }),
    "git rev-parse HEAD",
  ).stdout.trim();
  const remoteMain = requireResult(
    spawnSync("git", ["rev-parse", "refs/remotes/origin/main"], { cwd: repoRoot, encoding: "utf8" }),
    "git rev-parse origin/main",
  ).stdout.trim();
  if (head !== remoteMain) {
    throw new Error(`Release checkout ${head} is stale; current origin/main is ${remoteMain}. Dispatch again from main.`);
  }
}

function main() {
  const version = process.env.RELEASE_VERSION || "";
  const releaseMode = assertReleaseContext(version);
  for (const definition of agentPackageDefinitions) {
    if (releaseMode === "bootstrap") assertBootstrapCandidate(definition, version);
    else assertBootstrapExists(definition);
  }

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "dmfaster-agent-release-"));
  try {
    publishPackageSequence({
      version,
      packPackage(definition) {
        const result = requireResult(
          runNpm([
            "pack",
            "--json",
            "--workspace",
            definition.name,
            "--pack-destination",
            temporaryRoot,
          ]),
          `npm pack ${definition.name}`,
        );
        const report = parseJsonOutput(result, `npm pack ${definition.name}`)?.[0];
        return {
          name: report?.name,
          version: report?.version,
          integrity: report?.integrity,
          tarballPath: path.join(temporaryRoot, String(report?.filename || "")),
        };
      },
      getPublishedArtifact,
      beforePublish: assertCurrentMain,
      publishPackage(definition, artifact) {
        const result = requireResult(
          runNpm(["publish", artifact.tarballPath, "--access", "public", "--provenance", "--json"]),
          `npm publish ${definition.name}@${version}`,
        );
        const report = extractPublishedReport(
          parseJsonOutput(result, `npm publish ${definition.name}@${version}`),
          definition.name,
        );
        return {
          name: report?.name,
          version: report?.version,
          integrity: report?.integrity,
        };
      },
    });
  } finally {
    const expectedPrefix = path.join(tmpdir(), "dmfaster-agent-release-");
    if (!temporaryRoot.startsWith(expectedPrefix)) {
      throw new Error(`Refusing to clean an unexpected release path: ${temporaryRoot}`);
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) main();
