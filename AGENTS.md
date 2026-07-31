# DM Faster public agent source

This repository contains only the public, read-only DM Faster Agent API
contract, local authentication library, SDK, CLI, MCP server, and shared
Codex/Claude plugin.

## Task and tool routing

- Repository development is the default mode in this checkout. Use source, contract tests, package tests, and local diagnostics for debugging, implementation, review, and release work.
- Do not invoke the DM Faster skill, MCP server, or CLI merely because a repository task mentions campaigns, replies, sending, pipeline, or companies. Those interfaces inspect a user's live workspace; they are not repository-development tools.
- Use live DM Faster tools only when the user explicitly requests current workspace evidence or when an approved end-to-end test specifically exercises the public interface.
- Treat mixed prompts that ask to fix a product symptom as repository tasks first. Live observations supplement source evidence; they never replace it.

## Commands

- Use Node.js 24.
- Install with `npm ci`.
- Run `npm run check:agents` for the complete contract, build, package,
  installation, type, and unit test suite.
- Run `npm audit --omit=dev` before release.

## Source of truth

- Change `packages/public-api/openapi.yaml`, then run
  `npm run generate:agent-api`.
- Keep all four package versions, both plugin manifest versions, and all pinned
  installation commands identical.
- Keep the plugin skill under `plugins/dmfaster/skills/dmfaster/`.
- Keep repository-wide coding-agent instructions in this file. Root `CLAUDE.md` imports it instead of duplicating policy.
- Never add DM Faster application, database, extension, browser-worker, cookie,
  or private-repository dependencies.

## Release safety

- Never run raw `npm publish` from a workstation.
- First publication uses the guarded bootstrap workflow with a temporary
  granular npm credential and provenance.
- Later releases use trusted publishing through
  `.github/workflows/agent-packages-release.yml`.
- npm package versions are immutable. Fix mistakes with a new patch version.
