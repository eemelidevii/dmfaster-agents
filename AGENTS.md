# DM Faster public agent source

This repository contains only the public DM Faster Agent 1.0 API contract,
local authentication library, SDK, CLI, MCP server, portable campaign UI, and
shared Codex, Claude, and Cursor plugin.

## Task and tool routing

- Repository development is the default mode in this checkout. Use source,
  contract tests, package tests, and local diagnostics for implementation,
  review, and release work.
- Do not invoke the DM Faster skill, MCP server, or CLI merely because a
  repository task mentions campaigns, replies, sending, pipeline, or companies.
  Those interfaces operate a user's live workspace; they are not development
  tools.
- Use live DM Faster tools only when the user explicitly requests current
  workspace evidence or an approved end-to-end test targets the public
  interface.
- Treat mixed prompts that ask to fix a product symptom as repository tasks
  first. Live observations supplement source evidence; they never replace it.

## Commands

- Use Node.js 24.
- Install with `npm ci`.
- Run `npm run check:agents` for the complete contract, MCP protocol, build,
  package, clean-install, type, and unit test suite.
- Run `npm audit --omit=dev` before release.

## Source of truth

- Change `packages/public-api/openapi.yaml`, then run
  `npm run generate:agent-api`.
- Keep all four published package versions, all three plugin manifest versions,
  and every version-pinned command identical.
- `packages/product-ui` is a private build-only workspace used to generate the
  self-contained MCP Apps resource; it must never be published.
- Keep the canonical skill under `plugins/dmfaster/skills/dmfaster/`.
- Keep repository-wide coding-agent instructions in this file. Root
  `CLAUDE.md` imports it rather than duplicating policy.
- Never add DM Faster application, database, extension, browser-worker, cookie,
  or private-repository dependencies.

## Agent 1.0 boundary

- Planning and inspection tools are bounded reads.
- List and campaign preparation may create only private, disabled drafts and
  must remain idempotent.
- Launch and pause require a separate server-issued authorization bound to the
  exact campaign version after the owner approves it in DM Faster.
- Never add reply sending, meeting booking, provider-credential access,
  approval bypasses, or arbitrary workspace mutations.
- Exact audience totals are invariant. Never substitute a lower bound, sample,
  estimate, or guessed count.

## Release safety

- Never run raw `npm publish` from a workstation.
- First publication uses the guarded bootstrap workflow with a temporary,
  granular npm credential and provenance.
- Later releases use trusted publishing through
  `.github/workflows/agent-packages-release.yml`.
- npm versions are immutable. Fix mistakes with a new patch version.
- Package publication and marketplace submissions require explicit user
  approval in the active task.
