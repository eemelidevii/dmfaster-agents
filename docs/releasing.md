# Releasing agent packages

Package publication and plugin marketplace publication are separate releases.
Both require an explicitly reviewed version on public `main`.

## Preconditions

1. All four published package versions, all three plugin versions, and every
   pinned command match exactly. `packages/product-ui` remains private.
2. `npm run check:agents` passes, including strict MCP 2026-07-28 negotiation,
   all 16 domain tools, and the portable campaign workspace.
3. `npm audit --omit=dev` passes.
4. The production browser-authorization and action-approval backend is healthy.
5. GitHub environments and npm publishing identities are configured.

## First publication

The initial public package release is `1.0.0`. It uses
`.github/workflows/agent-packages-bootstrap.yml` because npm trusted publishing
cannot be configured until each package exists.

Create a short-lived granular npm token scoped only to the `@dmfaster`
organization, add it temporarily as the `NPM_TOKEN` secret in the
`npm-bootstrap` environment, and dispatch the workflow from `main` with:

- `version`: `1.0.0`
- `confirmation`: `bootstrap @dmfaster packages 1.0.0`

The workflow publishes the exact packed artifacts with npm provenance. After it
passes:

1. verify integrity and provenance for all four packages;
2. delete the GitHub `NPM_TOKEN` secret;
3. revoke the temporary npm token;
4. configure npm trusted publishing for each package against
   `eemelidevii/dmfaster-agents`, `agent-packages-release.yml`, the
   `npm-packages` environment, and the `npm publish` action.

Restrict both GitHub publishing environments to `main`. For a sole-owner
repository, keep the exact workflow confirmation, immutable source ref,
environment-scoped credential, and provenance checks as the release gate; do
not create a nominal second account solely to approve the owner's release. If
another maintainer is granted repository access, add that maintainer as the
required reviewer and prevent self-review for both publishing environments.

## Later releases

Dispatch `.github/workflows/agent-packages-release.yml` from `main` with:

- the exact aligned stable version;
- `publish @dmfaster packages VERSION`.

That workflow has no npm-token fallback. It obtains a short-lived npm
credential through GitHub OIDC.

## Plugin marketplace release

Only after the exact npm packages are publicly installable, validate all three
catalogs and test the complete plugin from clean host profiles:

- `.agents/plugins/marketplace.json` is the Codex catalog;
- `.claude-plugin/marketplace.json` is the Claude Code catalog;
- `.cursor-plugin/marketplace.json` is the Cursor catalog;
- all three point to `plugins/dmfaster/`.

Verify clean GitHub installs:

```bash
codex plugin marketplace add eemelidevii/dmfaster-agents
codex plugin add dmfaster@dmfaster-agents

claude plugin marketplace add eemelidevii/dmfaster-agents
claude plugin install dmfaster@dmfaster-agents
```

Start a new host session, authenticate through the browser flow, and verify a
workspace briefing, exact-audience preview, idempotent private draft, setup
handoff, and refusal to launch or pause without the separate owner approval.

With explicit approval, submit the public source through
`https://cursor.com/marketplace/publish`; Cursor reviews the publisher and
plugin separately. After acceptance, verify `/add-plugin dmfaster` in Cursor.

This local-stdio release is not eligible for the universal ChatGPT/Codex
Plugins Directory, which requires a publicly hosted MCP endpoint. Do not submit
an npm or GitHub URL as though it were a hosted MCP endpoint.

## Recovery

Never overwrite or routinely unpublish a release. Deprecate an incorrect
version, fix forward with a new patch version, and repeat the full review and
release. Revoke any temporary bootstrap credential immediately after use.
