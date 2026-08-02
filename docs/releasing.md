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

## npm package release

All four `@dmfaster` package names already exist on npm. Do not recreate a
token-based bootstrap path. Each package must trust GitHub Actions with these
exact settings:

- repository: `eemelidevii/dmfaster-agents`;
- workflow: `agent-packages-release.yml`;
- environment: `npm-packages`;
- allowed action: `npm publish`.

Restrict the `npm-packages` GitHub environment to `main`. For a sole-owner
repository, keep the exact workflow confirmation, immutable source ref,
environment boundary, and provenance checks as the release gate; do not create
a nominal second account solely to approve the owner's release. If another
maintainer is granted repository access, add that maintainer as the required
reviewer and prevent self-review.

Dispatch `.github/workflows/agent-packages-release.yml` from `main` with:

- the exact aligned stable version;
- `publish @dmfaster packages VERSION`.

That workflow has no npm-token fallback. It obtains a short-lived npm
credential through GitHub OIDC. After it passes, verify the exact version,
SHA-512 integrity, SLSA provenance, repository metadata, and a clean registry
install for all four packages. Keep npm package publishing access set to
require two-factor authentication and disallow bypass-2FA tokens; trusted OIDC
publishing continues to work with that restriction.

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
release. Never restore a persistent npm write-token fallback.
