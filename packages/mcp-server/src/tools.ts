import type {
  AgentToolInputMap,
  AgentToolName,
  AgentToolResult,
  CampaignStatus,
} from "@dmfaster/sdk";
import { z } from "zod";

export const MCP_AGENT_TOOL_NAMES = [
  "workspace_briefing",
  "campaigns_list",
  "campaign_inspect",
  "sending_inspect",
  "replies_list",
  "pipeline_inspect",
  "company_timeline",
  "industry_lookup",
  "campaign_validate",
  "audience_preview",
  "list_prepare",
  "campaign_prepare",
  "campaign_launch_preflight",
  "campaign_launch",
  "campaign_pause_preflight",
  "campaign_pause",
] as const;

export const MCP_PRESENTATION_TOOL_NAMES = ["campaign_workspace"] as const;

export const MCP_TOOL_NAMES = [
  ...MCP_AGENT_TOOL_NAMES,
  ...MCP_PRESENTATION_TOOL_NAMES,
] as const;

export type McpAgentToolName = (typeof MCP_AGENT_TOOL_NAMES)[number];
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export type AgentToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type AgentInvoker = {
  invoke<Name extends AgentToolName>(
    tool: Name,
    input: AgentToolInputMap[Name],
  ): Promise<AgentToolResult>;
};

export type AgentToolDefinition = {
  name: McpAgentToolName;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  annotations: AgentToolAnnotations;
  call(input: unknown): Promise<AgentToolResult>;
};

export type AgentToolRegistrar = {
  register(definition: AgentToolDefinition): void;
};

const readAnnotations: AgentToolAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const draftAnnotations: AgentToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const externalActionAnnotations: AgentToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
});

const workspaceActionAnnotations: AgentToolAnnotations = Object.freeze({
  readOnlyHint: false,
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

export const campaignIdSchema = z.string().trim().min(1).max(160).describe(
  "A campaign identifier returned by DM Faster. Never guess an identifier from a campaign name.",
);

const supportedCountries = [
  "FI", "NO", "EE", "SE", "DK", "UK", "IE", "AE", "AT", "BE",
  "CA", "NL", "NZ", "ES", "FR", "HK", "IL", "LV", "LT", "IT",
  "CH", "PT", "SA", "SG", "IS", "AU", "DE", "US", "ZA",
] as const;
const channels = ["instagram", "facebook", "linkedin", "gmail"] as const;
const signalKeys = [
  "recent_funding",
  "active_hiring",
  "leadership_change",
  "technology_usage",
  "content_activity",
  "purchase_intent",
] as const;
const tolVersion = z.enum(["2008", "2025"]);
const country = z.enum(supportedCountries);
const channel = z.enum(channels);
const industrySelection = z.object({
  classification: z.literal("TOL"),
  version: tolVersion,
  codes: z.array(z.string().max(5)).max(64),
}).strict();
const industryResolution = z.object({
  status: z.enum(["resolved", "needs_clarification", "unsupported"]),
  sourceText: z.string().max(800),
  resolvedLabel: z.string().max(240),
  primaryVersion: tolVersion,
  selections: z.array(industrySelection).max(2),
  question: z.string().max(500),
  options: z.array(z.object({
    id: z.string().max(80),
    label: z.string().max(180),
    selections: z.array(industrySelection).max(2),
  }).strict()).max(3),
  evidence: z.array(z.string().max(120)).max(12),
}).strict();
const nullableNumber = z.number().nullable();
export const campaignStateSchema = z.object({
  profile: z.object({
    version: z.literal(1),
    businessName: z.string(),
    websiteUrl: z.string(),
    businessDescription: z.string(),
    offer: z.string(),
    customerOutcome: z.string(),
    differentiators: z.array(z.string()),
    proofPoints: z.array(z.string()),
    preferredTone: z.string(),
    preferredLanguages: z.array(z.string()),
    defaultCountries: z.array(country),
    excludedCompanyTraits: z.array(z.string()),
  }).strict(),
  brief: z.object({
    version: z.literal(1),
    objective: z.string(),
    offer: z.string(),
    targetDescription: z.string(),
    countries: z.array(country),
    cities: z.array(z.string().trim().min(1).max(80)).max(32).optional(),
    industryCodes: z.array(z.string()),
    industryResolution: industryResolution.optional(),
    decisionMakerRoles: z.array(z.string()),
    companySize: z.object({
      employeeMin: nullableNumber,
      employeeMax: nullableNumber,
      revenueMinEur: nullableNumber,
      revenueMaxEur: nullableNumber,
    }).strict(),
    googleAdsActivityWindow: z.enum([
      "last_30_days",
      "last_90_days",
      "last_12_months",
    ]).nullable().optional(),
    metaAdsFilter: z.object({
      minimumEuReach: z.number().int().min(0).max(100_000_000).nullable(),
      targetAge: z.number().int().min(13).max(65).nullable(),
      targetGender: z.enum(["all", "men", "women"]).nullable(),
      targetLocation: z.string().max(80),
      includeUncorroborated: z.boolean(),
    }).strict().nullable().optional(),
    requestedSignals: z.array(z.object({
      key: z.enum(signalKeys),
      required: z.boolean(),
      description: z.string(),
    }).strict()),
    exclusions: z.array(z.string()),
    unsupportedCriteria: z.array(z.string().max(160)).max(8).optional(),
    callToAction: z.string(),
    requestedChannels: z.array(channel),
    messageLanguage: z.string(),
    tone: z.string(),
    dailyVolume: nullableNumber,
    deliverySettings: z.object({
      dailyCap: nullableNumber,
      windowStart: z.string(),
      windowEnd: z.string(),
      weekdays: z.number().int().min(1).max(127),
      timezone: z.string(),
      confirmed: z.boolean(),
    }).strict(),
    outreachMessages: z.array(z.object({
      channels: z.array(channel),
      subject: z.string(),
      body: z.string(),
      origin: z.enum([
        "user",
        "user_requested_generation",
        "agent_draft",
        "user_approved_generation",
      ]),
    }).strict()),
  }).strict(),
}).strict().refine(
  (value) => JSON.stringify(value).length <= 32_000,
  "The campaign state cannot exceed 32 KB.",
).describe(
  "Complete stateless campaign state. Send the latest returned or user-confirmed state on every planning call.",
);

const idempotencyKey = z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/).describe(
  "A stable caller-generated key for this exact intended operation. Reuse it when retrying; never reuse it for a different action.",
);
const authorizationId = z.string().trim().regex(/^agent_action_[a-f0-9]{32}$/).describe(
  "The server-issued authorization ID returned by the matching preflight tool after the owner approves it.",
);

function definition<Name extends AgentToolName>(input: {
  name: McpAgentToolName;
  tool: Name;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  client: AgentInvoker;
  annotations?: AgentToolAnnotations;
}): AgentToolDefinition {
  return {
    name: input.name,
    title: input.title,
    description: input.description,
    inputSchema: input.inputSchema,
    annotations: input.annotations || readAnnotations,
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
      description: "Start here when the user has not named a specific DM Faster resource. Read the authoritative workspace summary and current campaign and sending priorities.",
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
      inputSchema: z.object({ campaignId: campaignIdSchema.optional() }).strict(),
      client,
    }),
    definition({
      name: "sending_inspect",
      tool: "sending.inspect",
      title: "Inspect sending health",
      description: "Read browser-worker, queue, and failed-send health for the workspace or one campaign.",
      inputSchema: z.object({ campaignId: campaignIdSchema.optional() }).strict(),
      client,
    }),
    definition({
      name: "replies_list",
      tool: "replies.list",
      title: "List priority replies",
      description: "Read actual reply-stage records that need attention. Never infer replies from sent counts.",
      inputSchema: z.object({
        campaignId: campaignIdSchema.optional(),
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
      inputSchema: z.object({ campaignId: campaignIdSchema.optional() }).strict(),
      client,
    }),
    definition({
      name: "company_timeline",
      tool: "company.timeline",
      title: "Inspect company timeline",
      description: "Read the outreach event timeline for one company record in one campaign.",
      inputSchema: z.object({
        campaignId: campaignIdSchema,
        companyOutreachId: z.string().trim().min(1).max(160).describe(
          "A company outreach identifier returned by DM Faster.",
        ),
      }).strict(),
      client,
    }),
    definition({
      name: "industry_lookup",
      tool: "industry.lookup",
      title: "Resolve industry",
      description: "Resolve a natural-language industry or explicit TOL code into official executable TOL selections. Returns clarification instead of guessing.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(800).describe("Industry, activity, product, service, or explicit TOL code to resolve."),
        version: tolVersion.nullable().optional().describe("Preferred TOL classification version, or null for the authoritative default."),
        language: z.enum(["en", "fi"]).optional().describe("Language for clarification text."),
      }).strict(),
      client,
    }),
    definition({
      name: "campaign_validate",
      tool: "campaign.validate",
      title: "Validate campaign plan",
      description: "Validate a complete structured campaign state against DM Faster capabilities and domain rules without changing workspace data.",
      inputSchema: z.object({ state: campaignStateSchema }).strict(),
      client,
    }),
    definition({
      name: "audience_preview",
      tool: "audience.preview",
      title: "Preview exact audience",
      description: "Preview bounded company rows and the exact matching total. Never describe a total as final unless totalMatchesExact is true.",
      inputSchema: z.object({
        state: campaignStateSchema,
        sampleSize: z.number().int().min(1).max(25).optional(),
      }).strict(),
      client,
    }),
    definition({
      name: "list_prepare",
      tool: "list.prepare",
      title: "Prepare private company list",
      description: "Create an idempotent private company list from an exact validated audience. This does not start outreach.",
      inputSchema: z.object({
        state: campaignStateSchema,
        sampleSize: z.number().int().min(1).max(25).optional(),
        idempotencyKey: idempotencyKey.optional(),
      }).strict(),
      annotations: draftAnnotations,
      client,
    }),
    definition({
      name: "campaign_prepare",
      tool: "campaign.prepare",
      title: "Prepare campaign draft",
      description: "Create an idempotent private list and disabled campaign draft. Nothing is sent and the campaign is not started.",
      inputSchema: z.object({
        state: campaignStateSchema,
        sampleSize: z.number().int().min(1).max(25).optional(),
        idempotencyKey: idempotencyKey.optional(),
      }).strict(),
      annotations: draftAnnotations,
      client,
    }),
    definition({
      name: "campaign_launch_preflight",
      tool: "campaign.launch.preflight",
      title: "Preflight campaign launch",
      description: "Validate one exact campaign version without launching it. A setup_required result means the user must open setup.setupUrl, then you repeat setup.resume exactly; an approval_required result means show the approval URL and confirmation code, then repeat identical inputs after the owner decides.",
      inputSchema: z.object({ campaignId: campaignIdSchema, idempotencyKey }).strict(),
      annotations: workspaceActionAnnotations,
      client,
    }),
    definition({
      name: "campaign_launch",
      tool: "campaign.launch",
      title: "Launch approved campaign",
      description: "Start outreach only after the owner approved the matching preflight. Requires the same campaign ID and idempotency key plus the server-issued authorization ID. If the browser went offline and this returns browser_worker_required, repeat the matching preflight to receive its setup handoff.",
      inputSchema: z.object({ campaignId: campaignIdSchema, idempotencyKey, authorizationId }).strict(),
      annotations: externalActionAnnotations,
      client,
    }),
    definition({
      name: "campaign_pause_preflight",
      tool: "campaign.pause.preflight",
      title: "Preflight campaign pause",
      description: "Create or return the short-lived human approval for pausing one exact active campaign version. Repeat with identical inputs to verify approval status. This tool does not pause it.",
      inputSchema: z.object({ campaignId: campaignIdSchema, idempotencyKey }).strict(),
      annotations: workspaceActionAnnotations,
      client,
    }),
    definition({
      name: "campaign_pause",
      tool: "campaign.pause",
      title: "Pause approved campaign",
      description: "Pause a campaign only after the owner approved the matching preflight. Retries with the same idempotency key are safe.",
      inputSchema: z.object({ campaignId: campaignIdSchema, idempotencyKey, authorizationId }).strict(),
      annotations: workspaceActionAnnotations,
      client,
    }),
  ];
}

export function registerAgentToolDefinitions(registrar: AgentToolRegistrar, client: AgentInvoker) {
  for (const tool of createAgentToolDefinitions(client)) registrar.register(tool);
}
