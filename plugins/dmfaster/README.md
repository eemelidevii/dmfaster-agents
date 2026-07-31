# DM Faster agent plugin

This multi-host plugin bundles the canonical DM Faster skill and a version-pinned local stdio MCP server definition for Codex, Claude Code, and Cursor.

The current release exposes exactly seven read-only tools. It cannot create or edit campaigns, launch or pause sending, send replies, schedule work, book meetings, or spend credits.

## Release status

This source targets version `0.1.1` for the
[`eemelidevii/dmfaster-agents`](https://github.com/eemelidevii/dmfaster-agents)
GitHub marketplace. Publish and verify its four version-pinned `@dmfaster`
packages before treating the release as installable.

```bash
codex plugin marketplace add eemelidevii/dmfaster-agents
codex plugin add dmfaster@dmfaster-agents

claude plugin marketplace add eemelidevii/dmfaster-agents
claude plugin install dmfaster@dmfaster-agents
```

After the separate Cursor Marketplace review is approved, install from Cursor
Agent with `/add-plugin dmfaster`.

Repository maintainers must follow the
[public release guide](../../docs/releasing.md). Package publication and
marketplace publication remain separate approved releases.

## Authentication

Node.js 24 and macOS Keychain or Linux Secret Service are required. Windows is not supported in this release.

```bash
npx --yes @dmfaster/cli@0.1.1 auth login --json
```

The human signs in with their normal DM Faster account, compares the browser and CLI confirmation codes, reviews the workspace and read scopes, and personally approves or denies the request. The CLI and MCP server then share the operating-system credential.

## Development validation

- Codex manifest: `.codex-plugin/plugin.json`
- Shared MCP map: `.mcp.json`
- Claude manifest: `.claude-plugin/plugin.json`
- Cursor manifest: `.cursor-plugin/plugin.json`
- Canonical shared skill: `skills/dmfaster/`

Use the repository checks before packaging. Validate the complete manifests and
marketplace catalogs, then test clean Codex, Claude, and Cursor installs,
browser login, and representative CLI and MCP reads. Claude Code can also load
the complete directory during development with `claude --plugin-dir
./plugins/dmfaster`.
