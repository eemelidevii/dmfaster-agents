#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_OPENAPI_TYPESCRIPT_VERSION = "7.13.0";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(rootDir, "packages", "public-api", "openapi.yaml");
const outputPath = path.join(rootDir, "packages", "sdk", "src", "generated", "api.ts");
const check = process.argv.includes("--check");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--check");

if (unknownArguments.length > 0) {
  process.stderr.write(`Unknown argument${unknownArguments.length === 1 ? "" : "s"}: ${unknownArguments.join(" ")}\n`);
  process.exit(2);
}

function runOpenapiTypescript(arguments_) {
  const binary = path.join(
    rootDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "openapi-typescript.cmd" : "openapi-typescript",
  );
  const result = spawnSync(binary, arguments_, {
    cwd: rootDir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.error?.code === "ENOENT") {
    throw new Error(
      `openapi-typescript is not installed. Install the root dependencies (expected ${EXPECTED_OPENAPI_TYPESCRIPT_VERSION}).`,
    );
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "openapi-typescript failed.");
  }
  return result.stdout.trim();
}

const version = runOpenapiTypescript(["--version"]);
if (!new RegExp(`(^|\\D)${EXPECTED_OPENAPI_TYPESCRIPT_VERSION.replaceAll(".", "\\.")}($|\\D)`).test(version)) {
  throw new Error(
    `Expected openapi-typescript ${EXPECTED_OPENAPI_TYPESCRIPT_VERSION}, received ${version || "an unknown version"}.`,
  );
}

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "dmfaster-public-api-"));
const temporaryOutput = path.join(temporaryDirectory, "api.ts");

try {
  runOpenapiTypescript([
    contractPath,
    "--output",
    temporaryOutput,
    "--alphabetize",
  ]);
  const generated = await readFile(temporaryOutput, "utf8");

  if (check) {
    const existing = await readFile(outputPath, "utf8").catch(() => "");
    if (existing !== generated) {
      process.stderr.write("Generated public API types are stale. Run npm run generate:public-api.\n");
      process.exitCode = 1;
    } else {
      process.stdout.write("Generated public API types are up to date.\n");
    }
  } else {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, generated);
    process.stdout.write(`Generated ${path.relative(rootDir, outputPath)}.\n`);
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
