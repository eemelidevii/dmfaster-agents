# Releasing agent packages

Package publication and plugin marketplace publication are separate releases.
Both require an explicitly reviewed version on public `main`.

## Preconditions

1. All four package versions, all three plugin versions, and pinned documentation
   commands match.
2. `npm run check:agents` passes.
3. `npm audit --omit=dev` passes.
4. The production browser-authorization backend is healthy.
5. GitHub environments and npm publishing identities are configured.

## First publication

The initial `0.1.0` release uses
`.github/workflows/agent-packages-bootstrap.yml` because npm trusted publishing
cannot be configured until each package exists.

Create a short-lived granular npm token scoped only to the `@dmfaster`
organization, add it temporarily as the `NPM_TOKEN` secret in the
`npm-bootstrap` environment, and dispatch the workflow from `main` with:

- `version`: `0.1.0`
- `confirmation`: `bootstrap @dmfaster packages 0.1.0`

The workflow publishes the exact packed artifacts with npm provenance. After it
passes:

1. verify integrity and provenance for all four packages;
2. delete the GitHub `NPM_TOKEN` secret;
3. revoke the temporary token on npm;
4. configure npm trusted publishing for each package against
   `eemelidevii/dmfaster-agents`, `agent-packages-release.yml`, the
   `npm-packages` environment, and the `npm publish` action.

## Later releases

Dispatch `.github/workflows/agent-packages-release.yml` from `main` with:

- the exact aligned stable version;
- `publish @dmfaster packages VERSION`.

That workflow has no npm-token fallback. It obtains a short-lived npm
credential through GitHub OIDC.

## Plugin marketplace release

The repository is the public marketplace source for Codex, Claude Code, and
Cursor:

- `.agents/plugins/marketplace.json` is the Codex catalog;
- `.claude-plugin/marketplace.json` is the Claude Code catalog;
- `.cursor-plugin/marketplace.json` is the Cursor catalog;
- all three point to the canonical `plugins/dmfaster/` directory.

After package publication, merge the aligned plugin release to public `main`,
then verify clean installs from GitHub:

```bash
codex plugin marketplace add eemelidevii/dmfaster-agents
codex plugin add dmfaster@dmfaster-agents

claude plugin marketplace add eemelidevii/dmfaster-agents
claude plugin install dmfaster@dmfaster-agents
```

Test Cursor from a clean profile against the complete `plugins/dmfaster/`
directory before submission. With explicit approval, submit the public source
through `https://cursor.com/marketplace/publish`; Cursor reviews the publisher
and plugin separately. After the listing is approved, verify `/add-plugin
dmfaster` from Cursor Agent.

Start a new host session, authenticate through the focused browser flow, and
exercise representative read-only tools. Merging the GitHub catalogs does not
submit the plugin to Cursor Marketplace or the universal ChatGPT and Codex
Plugins Directory. Each listing requires its own publisher review materials
and separate approval.

## Recovery

Never overwrite or unpublish a release as routine recovery. Deprecate an
incorrect version, fix forward with a new patch version, and repeat the full
review and release.
