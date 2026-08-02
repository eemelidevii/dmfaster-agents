import type { components } from "./generated/api.ts";

/** Runtime counterpart to the OpenAPI-generated AgentToolName union. */
export const AGENT_TOOL_NAMES = [
  "workspace.briefing",
  "campaigns.list",
  "campaign.inspect",
  "sending.inspect",
  "replies.list",
  "pipeline.inspect",
  "company.timeline",
  "industry.lookup",
  "campaign.validate",
  "audience.preview",
  "list.prepare",
  "campaign.prepare",
  "campaign.launch.preflight",
  "campaign.launch",
  "campaign.pause.preflight",
  "campaign.pause",
] as const satisfies readonly components["schemas"]["AgentToolName"][];

export type AgentToolName = components["schemas"]["AgentToolName"];
export type AgentToolPolicy = components["schemas"]["AgentToolPolicy"];

export const AGENT_TOOL_POLICIES = Object.freeze({
  "workspace.briefing": { effect: "read", approval: "none", exposure: "public_api" },
  "campaigns.list": { effect: "read", approval: "none", exposure: "public_api" },
  "campaign.inspect": { effect: "read", approval: "none", exposure: "public_api" },
  "sending.inspect": { effect: "read", approval: "none", exposure: "public_api" },
  "replies.list": { effect: "read", approval: "none", exposure: "public_api" },
  "pipeline.inspect": { effect: "read", approval: "none", exposure: "public_api" },
  "company.timeline": { effect: "read", approval: "none", exposure: "public_api" },
  "industry.lookup": { effect: "read", approval: "none", exposure: "public_api" },
  "campaign.validate": { effect: "read", approval: "none", exposure: "public_api" },
  "audience.preview": { effect: "read", approval: "none", exposure: "public_api" },
  "list.prepare": { effect: "draft", approval: "none", exposure: "public_api" },
  "campaign.prepare": { effect: "draft", approval: "none", exposure: "public_api" },
  "campaign.launch.preflight": { effect: "write", approval: "none", exposure: "public_api" },
  "campaign.launch": { effect: "external", approval: "human_confirmation", exposure: "public_api" },
  "campaign.pause.preflight": { effect: "write", approval: "none", exposure: "public_api" },
  "campaign.pause": { effect: "write", approval: "human_confirmation", exposure: "public_api" },
} as const satisfies Record<AgentToolName, AgentToolPolicy>);

export type CampaignStatus = components["schemas"]["CampaignStatus"];

type OptionalLimit<Input> = Omit<Input, "limit"> & { limit?: number | undefined };

export type AgentToolInputMap = {
  "workspace.briefing": components["schemas"]["WorkspaceBriefingInput"];
  "campaigns.list": OptionalLimit<components["schemas"]["CampaignsListInput"]>;
  "campaign.inspect": components["schemas"]["CampaignInspectInput"];
  "sending.inspect": components["schemas"]["SendingInspectInput"];
  "replies.list": OptionalLimit<components["schemas"]["RepliesListInput"]>;
  "pipeline.inspect": components["schemas"]["PipelineInspectInput"];
  "company.timeline": components["schemas"]["CompanyTimelineInput"];
  "industry.lookup": components["schemas"]["IndustryLookupInput"];
  "campaign.validate": components["schemas"]["CampaignValidateInput"];
  "audience.preview": components["schemas"]["AudiencePreviewInput"];
  "list.prepare": components["schemas"]["ListPrepareInput"];
  "campaign.prepare": components["schemas"]["CampaignPrepareInput"];
  "campaign.launch.preflight": components["schemas"]["CampaignActionPreflightInput"];
  "campaign.launch": components["schemas"]["CampaignActionInput"];
  "campaign.pause.preflight": components["schemas"]["CampaignActionPreflightInput"];
  "campaign.pause": components["schemas"]["CampaignActionInput"];
};

export type AgentToolDataMap = {
  "workspace.briefing": components["schemas"]["WorkspaceBriefingOutput"];
  "campaigns.list": components["schemas"]["CampaignsListOutput"];
  "campaign.inspect": components["schemas"]["CampaignInspectOutput"];
  "sending.inspect": components["schemas"]["SendingInspectOutput"];
  "replies.list": components["schemas"]["RepliesListOutput"];
  "pipeline.inspect": components["schemas"]["PipelineInspectOutput"];
  "company.timeline": components["schemas"]["CompanyTimelineOutput"];
  "industry.lookup": components["schemas"]["IndustryLookupOutput"];
  "campaign.validate": components["schemas"]["AgentHarnessResult"];
  "audience.preview": components["schemas"]["AgentHarnessResult"];
  "list.prepare": components["schemas"]["AgentHarnessResult"];
  "campaign.prepare": components["schemas"]["AgentHarnessResult"];
  "campaign.launch.preflight": components["schemas"]["CampaignActionPreflightOutput"];
  "campaign.launch": components["schemas"]["CampaignActionOutput"];
  "campaign.pause.preflight": components["schemas"]["CampaignActionApprovalRequiredOutput"];
  "campaign.pause": components["schemas"]["CampaignActionOutput"];
};

export type AgentToolEvidence = components["schemas"]["AgentToolEvidence"];
export type AgentToolConsistency = components["schemas"]["AgentToolConsistency"];
export type AgentToolError = components["schemas"]["AgentToolError"];
export type AgentCampaignState = components["schemas"]["AgentCampaignState"];
export type AgentBusinessProfile = components["schemas"]["AgentBusinessProfile"];
export type AgentCampaignBrief = components["schemas"]["AgentCampaignBrief"];
export type AgentIndustryResolution = components["schemas"]["AgentIndustryResolution"];
export type AgentHarnessResult = components["schemas"]["AgentHarnessResult"];
export type AgentActionAuthorization = components["schemas"]["AgentActionAuthorization"];

export type AgentToolResult<Data = unknown> = Omit<
  components["schemas"]["AgentToolResultBase"],
  "tool" | "data"
> & {
  tool: AgentToolName;
  data: Data | null;
};

export function isAgentToolName(value: string): value is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(value);
}
