# DM Faster for agents

This repository is the public source for
[DM Faster](https://dmfaster.com) Agent 1.0:

- the versioned Agent API contract;
- secure browser authorization backed by the operating-system credential store;
- the typed JavaScript SDK and `dmfaster` CLI;
- the stateless MCP 2026-07-28 stdio server;
- a portable MCP Apps campaign workspace built from DM Faster's product UI;
- the shared Codex, Claude, and Cursor plugin and skill.

Agent 1.0 exposes 16 bounded domain tools. It can inspect a live workspace,
resolve industries, validate complete campaign plans, preview exact audiences,
prepare private lists and disabled campaign drafts idempotently, and launch or
pause only after the owner approves the exact campaign version in DM Faster.
It cannot send replies, book meetings, expose provider credentials, or bypass
the browser extension's execution boundary.

This repository intentionally contains no DM Faster application server,
database, browser extension, sending runtime, or private product source.

## Install the plugin

Node.js 24 and macOS Keychain or Linux Secret Service are required. Windows is
not supported in this release. Add the public GitHub marketplace, install DM
Faster, and start a new session so the skill and MCP server load.

### Codex

```bash
codex plugin marketplace add eemelidevii/dmfaster-agents
codex plugin add dmfaster@dmfaster-agents
```

### Claude Code

```bash
claude plugin marketplace add eemelidevii/dmfaster-agents
claude plugin install dmfaster@dmfaster-agents
```

### Cursor

The Cursor plugin is packaged in this repository. After its separate Cursor
Marketplace review is approved, install it from Cursor Agent with:

```text
/add-plugin dmfaster
```

Merging the manifest does not publish the universal Cursor listing.

## Authenticate

```bash
npx --yes @dmfaster/cli@1.0.0 auth login --json
```

The focused DM Faster page shows the exact workspace, expiry, scopes, and a
confirmation code that must match the CLI. Credentials are stored in macOS
Keychain or Linux Secret Service and are never written to plaintext config.
Use `--access read`, `plan`, or `draft` to grant a smaller capability ceiling;
the default `full` profile enables the complete Agent 1.0 flow.

Login permission alone never authorizes launch or pause. Those tools first
return a separate approval page and confirmation code. The owner must approve
the exact campaign version in DM Faster before the server issues a short-lived,
single-use action authorization.

## Use the CLI or MCP server directly

```bash
npx --yes @dmfaster/cli@1.0.0 workspace briefing --json
npx --yes @dmfaster/mcp-server@1.0.0
```

The 16 MCP domain tools cover workspace, campaign, sending, reply, pipeline,
company-history, industry, validation, exact-audience preview, private draft,
launch, and pause workflows. Compliant MCP Apps hosts can also render the
read-only `campaign_workspace` presentation tool inline. Headless hosts receive
the same complete state and keep every domain capability.

The MCP server is deliberately stateless: send the complete latest campaign
state on each planning call. Durable product state, permissions, idempotency,
and action approvals remain on DM Faster's server. Clients that have not
implemented MCP 2026-07-28 must use the version-pinned CLI; Agent 1.0 does not
silently downgrade to the 2025 protocol.

See [dmfaster.com/docs/agents](https://dmfaster.com/docs/agents) for host setup
and the complete tool workflow.

## Develop

```bash
npm ci
npm run check:agents
npm audit --omit=dev
```

The API schema in `packages/public-api/openapi.yaml` is the contract source of
truth. Regenerate SDK types with `npm run generate:agent-api`.

## Security boundary

The public clients reject plaintext non-loopback API origins, refuse redirects,
keep credentials out of URLs and process arguments, require exact audience
counts, make draft mutations idempotent, and do not accept conversational
approval in place of server-issued action authorization.

Report vulnerabilities through GitHub private vulnerability reporting. Do not
open a public issue containing credentials, customer information, or an
unpatched exploit.

## License

The source in this repository is licensed under Apache License 2.0. This
license applies only to this public repository and does not cover DM Faster's
private product source or trademarks.
