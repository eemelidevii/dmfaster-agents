# @dmfaster/local-auth

Secure local authentication shared by the official DM Faster CLI and MCP
server. It implements DM Faster's browser-approved device authorization flow,
stores issued credentials in the operating system's credential store, and
supports `DMFASTER_TOKEN` for non-interactive CI environments.

This source targets version `0.1.1`. The command below installs the exact
release after it is available on npm with provenance.

```sh
npm install @dmfaster/local-auth@0.1.1
```

Application integrations normally use `@dmfaster/sdk` directly. This package
is the lower-level authentication layer for DM Faster's official local clients.
It never stores an access token in the DM Faster config file.

The supported runtime is Node.js 24. Browser sign-in defaults to
`https://app.dmfaster.com`; compatible loopback API endpoints are available for
local development and tests.
