import type {
  AgentToolInputMap,
  AgentToolName,
  AgentToolResult,
  CampaignStatus,
} from "@dmfaster/sdk";
import { z } from "zod";

export const MCP_TOOL_NAMES = [
  "workspace_briefing",
  "campaigns_list",
  "campaign_inspect",
  "sending_inspect",
  "replies_list",
  "pipeline_inspect",
  "company_timeline",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export type ReadOnlyToolAnnotations = {
  readOnlyHint: true;
  destructiveHint: false;
  idempotentHint: true;
  openWorldHint: false;
};

export type AgentInvoker = {
  invoke<Name extends AgentToolName>(
    tool: Name,
    input: AgentToolInputMap[Name],
  ): Promise<AgentToolResult>;
};

export type AgentToolDefinition = {
  name: McpToolName;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  annotations: ReadOnlyToolAnnotations;
  call(input: unknown): Promise<AgentToolResult>;
};

export type AgentToolRegistrar = {
  register(definition: AgentToolDefinition): void;
};

const annotations: ReadOnlyToolAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const campaignStatuses: [CampaignStatus, ...CampaignStatus[]] = [
  "Draft",
  "Queued",
  "Running",
  "Paused",
  "Cooldown",
  "Completed",
];

const campaignId = z.string().trim().min(1).max(160).describe(
  "A campaign identifier returned by DM Faster. Never guess an identifier from a campaign name.",
);

function definition<Name extends AgentToolName>(input: {
  name: McpToolName;
  tool: Name;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  client: AgentInvoker;
}): AgentToolDefinition {
  return {
    name: input.name,
    title: input.title,
    description: input.description,
    inputSchema: input.inputSchema,
    annotations,
    call: async (value) => input.client.invoke(
      input.tool,
      input.inputSchema.parse(value) as AgentToolInputMap[Name],
    ),
  };
}

export function createAgentToolDefinitions(client: AgentInvoker): AgentToolDefinition[] {
  return [
    definition({
      name: "workspace_briefing",
      tool: "workspace.briefing",
      title: "Workspace briefing",
      description: "Read the authoritative workspace summary and current campaign and sending priorities.",
      inputSchema: z.object({}).strict(),
      client,
    }),
    definition({
      name: "campaigns_list",
      tool: "campaigns.list",
      title: "List campaigns",
      description: "List campaigns in the current workspace, optionally filtered by status.",
      inputSchema: z.object({
        status: z.enum(campaignStatuses).optional().describe("Optional exact campaign status."),
        limit: z.number().int().min(1).max(25).optional().describe("Maximum campaigns to return."),
      }).strict(),
      client,
    }),
    definition({
      name: "campaign_inspect",
      tool: "campaign.inspect",
      title: "Inspect campaign",
      description: "Read delivery, outcome, and pipeline facts for a campaign identifier returned by DM Faster.",
      inputSchema: z.object({ campaignId: campaignId.optional() }).strict(),
      client,
    }),
    definition({
      name: "sending_inspect",
      tool: "sending.inspect",
      title: "Inspect sending health",
      description: "Read browser-worker, queue, and failed-send health for the workspace or one campaign.",
      inputSchema: z.object({ campaignId: campaignId.optional() }).strict(),
      client,
    }),
    definition({
      name: "replies_list",
      tool: "replies.list",
      title: "List priority replies",
      description: "Read actual reply-stage records that need attention. Never infer replies from sent counts.",
      inputSchema: z.object({
        campaignId: campaignId.optional(),
        limit: z.number().int().min(1).max(20).optional().describe("Maximum replies to return."),
        query: z.string().trim().min(1).max(120).optional().describe("Optional reply search text."),
      }).strict(),
      client,
    }),
    definition({
      name: "pipeline_inspect",
      tool: "pipeline.inspect",
      title: "Inspect pipeline",
      description: "Read contacted, replied, booked-call, and closed pipeline counts for a campaign.",
      inputSchema: z.object({ campaignId: campaignId.optional() }).strict(),
      client,
    }),
    definition({
      name: "company_timeline",
      tool: "company.timeline",
      title: "Inspect company timeline",
      description: "Read the outreach event timeline for one company record in one campaign.",
      inputSchema: z.object({
        campaignId,
        companyOutreachId: z.string().trim().min(1).max(160).describe(
          "A company outreach identifier returned by DM Faster.",
        ),
      }).strict(),
      client,
    }),
  ];
}

export function registerAgentToolDefinitions(registrar: AgentToolRegistrar, client: AgentInvoker) {
  for (const tool of createAgentToolDefinitions(client)) registrar.register(tool);
}
