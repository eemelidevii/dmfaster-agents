# DM Faster for agents

This repository contains the public, read-only agent interface for
[DM Faster](https://dmfaster.com):

- the versioned Agent API contract;
- secure browser authorization backed by the operating-system credential store;
- the typed JavaScript SDK;
- the `dmfaster` command-line client;
- the `dmfaster-mcp` stdio MCP server;
- the shared Codex and Claude plugin and skill.

It intentionally contains no DM Faster application server, database, browser
extension, sending runtime, private product source, or write-capable tools.

## Install

Node.js 24 is required.

```bash
npx --yes @dmfaster/cli@0.1.0 auth login --json
npx --yes @dmfaster/cli@0.1.0 workspace briefing --json
npx --yes @dmfaster/mcp-server@0.1.0
```

Browser authorization grants only the exact read scopes shown on the approval
page. Credentials are stored in macOS Keychain or Linux Secret Service and are
never written to a plaintext configuration file.

The MCP server exposes exactly seven read-only tools:

- `workspace_briefing`
- `campaigns_list`
- `campaign_inspect`
- `sending_inspect`
- `replies_list`
- `pipeline_inspect`
- `company_timeline`

See [dmfaster.com/docs/agents](https://dmfaster.com/docs/agents) for host setup
instructions.

## Develop

```bash
npm ci
npm run check:agents
npm audit --omit=dev
```

The API schema in `packages/public-api/openapi.yaml` is the contract source of
truth. Regenerate SDK types with `npm run generate:agent-api`.

## Security boundary

The public clients reject plaintext non-loopback API origins, refuse
redirect-following, keep credentials out of URLs and process arguments, and do
not implement campaign mutations, message sending, scheduling, or other
external actions.

Report vulnerabilities through GitHub private vulnerability reporting. Do not
open a public issue containing credentials, customer information, or an
unpatched exploit.

## License

The source in this repository is licensed under Apache License 2.0. This
license applies only to this public repository and does not cover DM Faster's
private product source or trademarks.
