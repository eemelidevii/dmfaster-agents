# Contributing

DM Faster Agent 1.0 is deliberately bounded. Contributions must preserve its
planning reads, idempotent private-draft preparation, and owner-approved launch
or pause protocol. Do not add reply sending, meeting booking, provider
credential access, arbitrary workspace mutations, approval bypasses,
browser-cookie access, database access, or private product dependencies.

Before opening a pull request:

```bash
npm ci
npm run check:agents
npm audit --omit=dev
```

Keep the OpenAPI contract, generated SDK types, CLI, MCP server, plugin
metadata, marketplace catalogs, documentation, and exact version pins aligned.
Generated SDK types must be updated with `npm run generate:agent-api`.

By submitting a contribution, you agree that it is licensed under Apache
License 2.0.
