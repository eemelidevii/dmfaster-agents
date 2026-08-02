import {
  createDmfasterClient,
  DmfasterHttpError,
  DmfasterSdkError,
  type AgentToolResult,
  type DmfasterClientOptions,
} from "@dmfaster/sdk";
import {
  DEFAULT_DMFASTER_API_URL,
  resolveLocalAuthConfig,
  type CredentialStore,
} from "@dmfaster/local-auth";
import { McpServer } from "@modelcontextprotocol/server";
import {
  serveStdio,
  type ServeStdioOptions,
} from "@modelcontextprotocol/server/stdio";

import {
  registerAgentToolDefinitions,
  type AgentInvoker,
  type AgentToolDefinition,
} from "./tools.ts";
import { registerCampaignWorkspace } from "./campaign-workspace.ts";

export const MCP_SERVER_VERSION = "1.0.0";
export const DEFAULT_MCP_API_URL = DEFAULT_DMFASTER_API_URL;
export const MCP_SERVER_INSTRUCTIONS = [
  "DM Faster lets a user describe a sales campaign while you operate the bounded workflow for them; do not assume prior product knowledge.",
  "Start with workspace_briefing for existing-workspace context.",
  "For a new campaign, assemble one complete campaign state, resolve uncertain industries with industry_lookup, then call campaign_validate, audience_preview, and campaign_prepare in order.",
  "When the host renders MCP Apps, use campaign_workspace to let the user review that complete state; headless hosts continue with the same state and domain tools.",
  "Preparation creates only a private disabled draft and requires an exact audience; keep the latest complete state because this MCP server is stateless.",
  "Launch requires campaign_launch_preflight followed by the owner's focused approval and campaign_launch with the same campaign ID and idempotency key.",
  "If launch preflight returns status setup_required, show its setup.setupUrl to the user, leave the campaign disabled, and repeat the exact resume tool input after the user completes browser setup.",
  "Never operate a human approval or browser-store page on the user's behalf, guess resource IDs, expose credentials, or claim an action succeeded without a verified tool result.",
].join(" ");

function asStructuredContent(result: AgentToolResult) {
  return result as unknown as Record<string, unknown>;
}

function toolResult(result: AgentToolResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: asStructuredContent(result),
    ...(result.ok ? {} : { isError: true }),
  };
}

export function toolFailure(error: unknown) {
  const httpError = error instanceof DmfasterHttpError ? error : null;
  const body = {
    error: {
      code: error instanceof DmfasterSdkError ? error.code : "mcp_tool_failed",
      message: error instanceof Error ? error.message : "DM Faster tool execution failed.",
      ...(typeof httpError?.retryable === "boolean" ? { retryable: httpError.retryable } : {}),
      ...(httpError?.requestId ? { requestId: httpError.requestId } : {}),
      ...(typeof httpError?.retryAfterSeconds === "number"
        ? { retryAfterSeconds: httpError.retryAfterSeconds }
        : {}),
      ...(httpError?.details ? { details: httpError.details } : {}),
      ...(httpError ? { status: httpError.status } : {}),
    },
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
    isError: true,
  };
}

function registerWithMcpServer(server: McpServer, definition: AgentToolDefinition) {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: definition.annotations,
    },
    async (input) => {
      try {
        return toolResult(await definition.call(input));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );
}

export function createDmfasterMcpServer(input: { client: AgentInvoker }) {
  const server = new McpServer({
    name: "dmfaster",
    version: MCP_SERVER_VERSION,
  }, {
    instructions: MCP_SERVER_INSTRUCTIONS,
  });
  registerAgentToolDefinitions({
    register(definition) {
      registerWithMcpServer(server, definition);
    },
  }, input.client);
  registerCampaignWorkspace(server);
  return server;
}

export type DmfasterStdioOptions = Omit<ServeStdioOptions, "legacy">;

export function serveDmfasterStdio(
  client: AgentInvoker,
  options: DmfasterStdioOptions = {},
) {
  return serveStdio(() => createDmfasterMcpServer({ client }), {
    ...options,
    legacy: "reject",
  });
}

export async function resolveMcpClientOptions(
  env: NodeJS.ProcessEnv,
  input: { homeDirectory?: string; credentialStore?: CredentialStore } = {},
): Promise<DmfasterClientOptions> {
  const config = await resolveLocalAuthConfig({
    env,
    ...(input.homeDirectory ? { homeDirectory: input.homeDirectory } : {}),
    ...(input.credentialStore ? { credentialStore: input.credentialStore } : {}),
  });
  if (!config.token) {
    throw new Error(
      config.credentialStoreError
        || "DM Faster is not signed in. Run `dmfaster auth login`, or set DMFASTER_TOKEN for headless CI.",
    );
  }
  const timeoutSource = env.DMFASTER_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutSource ? Number(timeoutSource) : undefined;
  return {
    baseUrl: config.baseUrl,
    token: config.token,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

export async function startStdioServer(
  env: NodeJS.ProcessEnv = process.env,
  input: { homeDirectory?: string; credentialStore?: CredentialStore } = {},
) {
  const client = createDmfasterClient(await resolveMcpClientOptions(env, input));
  return serveDmfasterStdio(client);
}
