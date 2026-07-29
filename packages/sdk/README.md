# @dmfaster/sdk

Typed Node.js client for the versioned DM Faster Agent API. The developer
preview exposes only the seven read-only tools and authenticates with a scoped,
workspace-bound `dmf_pat_…` token.

> Distribution note: the registry command below works only after this exact
> release is published. Before then, maintainers use the built package from an
> authorized source checkout.

```bash
npm install @dmfaster/sdk@0.1.0
```

Non-loopback endpoints must use HTTPS. The client also refuses HTTP redirects so
the bearer token cannot be forwarded to a different origin.

```ts
import { createDmfasterClient } from "@dmfaster/sdk";

const client = createDmfasterClient({
  baseUrl: process.env.DMFASTER_API_URL!,
  token: process.env.DMFASTER_TOKEN!,
});

const result = await client.invoke("campaigns.list", {
  status: "Running",
  limit: 10,
});
```

The caller must provide an absolute API base URL and a scoped bearer token.
The SDK sends tool inputs directly to
`POST /api/v1/agent/tools/{toolName}`, applies a bounded timeout, and validates
the shared result envelope before returning it.
