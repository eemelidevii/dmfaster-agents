# DM Faster MCP server

Stdio MCP server for the seven read-only DM Faster Agent API tools. Authenticate
first through the DM Faster CLI's focused browser flow; the MCP server resolves
the same operating-system stored credential.

This source targets version `0.1.1`. The commands below use the exact release
after it is available on npm with provenance.

```bash
npx --yes @dmfaster/cli@0.1.1 auth login --json
npx --yes @dmfaster/mcp-server@0.1.1
```

The process uses stdout only for MCP protocol messages. Startup and fatal errors
go to stderr. Every registered tool is annotated as read-only, non-destructive,
and idempotent. The seven MCP names are:

- `workspace_briefing`
- `campaigns_list`
- `campaign_inspect`
- `sending_inspect`
- `replies_list`
- `pipeline_inspect`
- `company_timeline`

For a local Codex, Claude, Cursor, or other MCP host, use this version-pinned stdio
entry:

```json
{
  "mcpServers": {
    "dmfaster": {
      "command": "npx",
      "args": ["--yes", "@dmfaster/mcp-server@0.1.1"]
    }
  }
}
```

Production defaults to `https://app.dmfaster.com`; use `DMFASTER_API_URL` only
for local development or self-hosting. `DMFASTER_TOKEN` remains an explicit
developer override, but it must never be pasted into chat or MCP tool inputs.
