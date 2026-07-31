# DM Faster CLI

Read-only CLI for the DM Faster Agent API. Run the version-pinned package, then
authenticate through the focused DM Faster browser approval page.

Version `0.1.0` is published on npm with provenance. The commands below use the
public release directly.

```bash
npx --yes @dmfaster/cli@0.1.0 auth login --json
npx --yes @dmfaster/cli@0.1.0 auth status --json

npx --yes @dmfaster/cli@0.1.0 workspace briefing --json
npx --yes @dmfaster/cli@0.1.0 campaigns list --status Running --limit 10 --json
npx --yes @dmfaster/cli@0.1.0 replies list campaign_123 --limit 5 --query "Visio" --json
npx --yes @dmfaster/cli@0.1.0 company timeline campaign_123 outreach_456 --json
npx --yes @dmfaster/cli@0.1.0 auth logout --json
```

`auth login` creates a short-lived PKCE device request, prints a confirmation
code, opens the same request in the user's browser, and polls until the user
approves, denies, or lets it expire. The user must compare the browser and CLI
codes and review the exact workspace, expiry, and scopes. The browser never
receives the issued credential.

Login emits two newline-delimited JSON events on stdout: first
`authorization_required`, then `authenticated` after a successful exchange.
Human instructions and warnings go to stderr, so scripts can parse stdout
without scraping prose.

Approved credentials are stored in macOS Keychain or Linux Secret Service
(`secret-tool`). Unsupported credential stores fail closed and never write a
plaintext fallback. `auth status` verifies the configured credential with the
server. `auth logout` revokes a stored credential before deleting it locally.

`--json` is accepted anywhere and JSON is the default for every API command.
Run `dmfaster --help` for the complete read-only command list. The production
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
