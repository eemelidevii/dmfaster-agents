# DM Faster MCP server

Local stdio MCP server for the 16 DM Faster Agent 1.0 domain tools plus one
portable `campaign_workspace` presentation tool. It uses the MCP TypeScript SDK
v2 serving entry in strict modern-only mode. MCP 2026-07-28 clients use the new
per-request protocol; 2025-era initialization is explicitly rejected. The
server is deliberately stateless; the caller sends the complete latest campaign
state on each planning call, while durable product state, permissions,
idempotency, and approvals remain on DM Faster's server.

The server advertises host-neutral operating instructions through MCP discovery,
so an agent without a DM Faster-specific prompt can start with a workspace
briefing and carry a plain-language campaign goal through validation, exact
preview, private draft preparation, browser setup, and owner-approved launch.

Hosts implementing the standard MCP Apps extension render
`campaign_workspace` as an inline campaign editor. The self-contained
`ui://dmfaster/campaign-workspace/v1.html` resource uses the MCP Apps
`2026-01-26` bridge and requires no external scripts, styles, frames, cookies,
or network access. It can validate the current state, preview an exact audience,
prepare a private disabled draft, request launch approval, and sync edits back
into model context. It cannot execute launch or pause. Codex and other headless
hosts receive the same state and safety description as structured content and
continue to use all 16 domain tools directly.

Authenticate first through the DM Faster CLI's focused browser flow. The MCP
server resolves the same operating-system stored credential.

> Distribution note: the registry commands below work only after this exact
> release is published. Before then, maintainers configure the built MCP server
> from an authorized source checkout.

```bash
npx --yes @dmfaster/cli@1.0.0 auth login --json
npx --yes @dmfaster/mcp-server@1.0.0
```

Login defaults to the complete Agent 1.0 capability set. Use `auth login
--access read`, `plan`, or `draft` when this MCP installation should have a
smaller ceiling. The MCP server can expose all 16 domain schemas and the
read-only presentation schema while the DM Faster API independently rejects
domain tools outside the stored credential's scopes.

The process uses stdout only for MCP protocol messages. Startup and fatal errors
go to stderr. Tool annotations accurately distinguish reads, private draft
preparation, workspace controls, and the external launch action. Every mutation
is idempotent. Launch is marked destructive and open-world.

The MCP names are the 16 domain tools:

- `workspace_briefing`
- `campaigns_list`
- `campaign_inspect`
- `sending_inspect`
- `replies_list`
- `pipeline_inspect`
- `company_timeline`
- `industry_lookup`
- `campaign_validate`
- `audience_preview`
- `list_prepare`
- `campaign_prepare`
- `campaign_launch_preflight`
- `campaign_launch`
- `campaign_pause_preflight`
- `campaign_pause`

The additional presentation-only MCP tool is:

- `campaign_workspace`

Planning and preview tools do not mutate the workspace. Preparation creates
private drafts with a stable idempotency key. Launch and pause use a two-step
server-enforced protocol: preflight the exact campaign and command, let the
owner approve it on the returned DM Faster page, then call the action with the
server-issued authorization ID and the same idempotency key. An `approved: true`
tool argument does not exist and cannot authorize an action.

For browser-based campaigns, launch preflight returns `setup_required` until a
fresh browser worker is connected. The result contains one `setup.setupUrl` and
an exact `setup.resume` call. The agent shows that link and keeps the campaign
disabled; the user installs or reconnects the extension in their own browser,
then the agent resumes the same preflight. A website or agent cannot silently
install a browser extension.

For a local host that supports MCP 2026-07-28, use this version-pinned stdio
entry:

```json
{
  "mcpServers": {
    "dmfaster": {
      "command": "npx",
      "args": ["--yes", "@dmfaster/mcp-server@1.0.0"]
    }
  }
}
```

Hosts that have not implemented MCP 2026-07-28 must use the version-pinned CLI
until they upgrade. Agent 1.0 does not silently downgrade to the 2025 protocol.

Production defaults to `https://app.dmfaster.com`; use `DMFASTER_API_URL` only
for local development or self-hosting. `DMFASTER_TOKEN` remains an explicit
developer override, but it must never be pasted into chat or MCP tool inputs.
