# @dmfaster/local-auth

Secure local authentication shared by the official DM Faster CLI and MCP
server. It implements DM Faster's browser-approved device authorization flow,
stores issued credentials in the operating system's credential store, and
supports `DMFASTER_TOKEN` for non-interactive CI environments.

> Distribution note: the registry command below works only after this exact
> release is published. Before then, maintainers use the built package from an
> authorized source checkout.

```sh
npm install @dmfaster/local-auth@1.0.0
```

Application integrations normally use `@dmfaster/sdk` directly. This package
is the lower-level authentication layer for DM Faster's official local clients.
It never stores an access token in the DM Faster config file.

Device authorization supports the `read`, `plan`, `draft`, and `full` access
profiles. `beginDeviceAuthorization({ access: "plan" })` requests only the five
operational read scopes plus `audiences:read`; omitting `access` requests the
complete `full` Agent 1.0 scope set. The browser approval page remains the
authority for the workspace and permissions actually granted.

The supported runtime is Node.js 24. Browser sign-in defaults to
`https://app.dmfaster.com`; compatible loopback API endpoints are available for
local development and tests.
