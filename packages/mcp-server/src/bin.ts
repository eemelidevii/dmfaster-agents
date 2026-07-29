#!/usr/bin/env node

import { startStdioServer } from "./server.ts";

try {
  await startStdioServer();
} catch (error) {
  process.stderr.write(
    `dmfaster-mcp: ${error instanceof Error ? error.message : "Unable to start MCP server."}\n`,
  );
  process.exitCode = 1;
}
