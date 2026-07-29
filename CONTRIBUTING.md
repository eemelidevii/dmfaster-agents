# Contributing

DM Faster agent interfaces are deliberately narrow. Contributions must
preserve the read-only public boundary and must not add message sending,
campaign mutation, scheduling, browser-cookie access, database access, or
private product dependencies.

Before opening a pull request:

```bash
npm ci
npm run check:agents
npm audit --omit=dev
```

Keep the OpenAPI contract, generated SDK types, CLI, MCP server, plugin
metadata, documentation, and exact version pins aligned. Generated SDK types
must be updated with `npm run generate:agent-api`.

By submitting a contribution, you agree that it is licensed under Apache
License 2.0.
