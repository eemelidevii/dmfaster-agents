# DM Faster CLI

CLI for DM Faster Agent 1.0. Run the version-pinned package, then authenticate
through the focused DM Faster browser approval page.

> Distribution note: the registry commands below work only after this exact
> release is published. Before then, maintainers use the built CLI from an
> authorized source checkout.

```bash
npx --yes @dmfaster/cli@1.0.0 auth login --json
npx --yes @dmfaster/cli@1.0.0 auth login --access plan --json
npx --yes @dmfaster/cli@1.0.0 auth status --json

npx --yes @dmfaster/cli@1.0.0 workspace briefing --json
npx --yes @dmfaster/cli@1.0.0 campaigns list --status Running --limit 10 --json
npx --yes @dmfaster/cli@1.0.0 replies list campaign_123 --limit 5 --query "Visio" --json
npx --yes @dmfaster/cli@1.0.0 company timeline campaign_123 outreach_456 --json

npx --yes @dmfaster/cli@1.0.0 campaign validate --state campaign-state.json --json
npx --yes @dmfaster/cli@1.0.0 audience preview --state campaign-state.json --json
npx --yes @dmfaster/cli@1.0.0 campaign prepare --state campaign-state.json --idempotency-key prepare-001 --json
npx --yes @dmfaster/cli@1.0.0 campaign launch preflight campaign_123 --idempotency-key launch-001 --json
npx --yes @dmfaster/cli@1.0.0 campaign launch campaign_123 --idempotency-key launch-001 --authorization-id agent_action_… --json

npx --yes @dmfaster/cli@1.0.0 auth logout --json
```

`auth login` creates a short-lived PKCE device request, prints a confirmation
code, opens the same request in the user's browser, and polls until the user
approves, denies, or lets it expire. The user must compare the browser and CLI
codes and review the exact workspace, expiry, and permissions. The browser never
receives the issued credential.

Login defaults to the complete `full` profile. Use `--access` to grant only the
needed capability set:

| Profile | Capability |
| --- | --- |
| `read` | inspect workspace, campaigns, sending, replies, and pipeline |
| `plan` | `read` plus industry lookup, validation, and exact audience preview |
| `draft` | `plan` plus private list/campaign preparation and approved pause requests |
| `full` | `draft` plus approved campaign launch |

The server still checks every exact scope, workspace membership, owner-only
rule, and action authorization. An access profile is a credential ceiling, not
an action approval.

Login emits two newline-delimited JSON events on stdout: first
`authorization_required`, then `authenticated` after a successful exchange.
Human instructions and warnings go to stderr, so scripts can parse stdout
without scraping prose.

Approved credentials are stored in macOS Keychain or Linux Secret Service
(`secret-tool`). Unsupported credential stores fail closed and never write a
plaintext fallback. `auth status` verifies the configured credential with the
server. `auth logout` revokes a stored credential before deleting it locally.

Campaign state files contain the complete latest state returned or confirmed by
the caller. Re-send that state for every validation, audience, or preparation
call; the MCP/API process does not keep a hidden planning session. Preparation
commands create private resources and require stable idempotency keys.

Agents should assume the user does not know DM Faster's fields or command names:
translate the user's goal into the complete state, ask only for material missing
facts, and carry validation, exact preview, and private draft preparation in
order. `dmfaster --help` includes the same quick-start sequence for CLI-only
hosts.

Launch and pause require a separate short-lived approval in DM Faster for the
exact campaign version. A launch preflight can first return `setup_required`;
show `setup.setupUrl`, keep the campaign disabled, and repeat the exact
`setup.resume` call after the human installs or reconnects the extension. Once
preflight returns `approval_required`, the response supplies the approval page
and authorization ID. The human controls both the browser-store and approval
pages. After approval, retry the action with the same campaign ID and
idempotency key plus the authorization ID. Scripts can repeat the identical
preflight first to verify that the existing authorization now reports
`approved`; that retry never creates a second request.

`--json` is accepted anywhere and JSON is the default for every API command.
Run `dmfaster --help` for the complete Agent 1.0 command list. The production
API URL defaults to `https://app.dmfaster.com`.

The CLI also reads `$XDG_CONFIG_HOME/dmfaster/config.json` (or
`~/.config/dmfaster/config.json`):

```json
{
  "baseUrl": "https://app.dmfaster.com"
}
```

Environment variables take precedence. `DMFASTER_API_URL` overrides the base
URL for local development or self-hosting. `DMFASTER_TOKEN` remains an explicit
developer credential override and takes precedence over the operating-system
store; the CLI rejects plaintext token fields in the JSON config. Never paste a
DM Faster token into chat or MCP configuration.
