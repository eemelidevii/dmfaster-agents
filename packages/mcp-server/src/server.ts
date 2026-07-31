import {
  createDmfasterClient,
  DmfasterSdkError,
  type AgentToolResult,
  type DmfasterClientOptions,
} from "@dmfaster/sdk";
import {
  DEFAULT_DMFASTER_API_URL,
  resolveLocalAuthConfig,
  type CredentialStore,
} from "@dmfaster/local-auth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  registerAgentToolDefinitions,
  type AgentInvoker,
  type AgentToolDefinition,
} from "./tools.ts";

export const MCP_SERVER_VERSION = "0.1.1";
export const DEFAULT_MCP_API_URL = DEFAULT_DMFASTER_API_URL;

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

function toolFailure(error: unknown) {
  const body = {
    error: {
      code: error instanceof DmfasterSdkError ? error.code : "mcp_tool_failed",
      message: error instanceof Error ? error.message : "DM Faster tool execution failed.",
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
  });
  registerAgentToolDefinitions({
    register(definition) {
      registerWithMcpServer(server, definition);
    },
  }, input.client);
  return server;
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
  const server = createDmfasterMcpServer({ client });
  await server.connect(new StdioServerTransport());
  return server;
}
