#!/usr/bin/env node

import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageNames = ["local-auth", "sdk", "cli", "mcp-server"];

for (const packageName of packageNames) {
  const output = path.join(repoRoot, "packages", packageName, "dist");
  await rm(output, { recursive: true, force: true });
}
