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
] as const satisfies readonly components["schemas"]["AgentToolName"][];

export type AgentToolName = components["schemas"]["AgentToolName"];

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
};

export type AgentToolDataMap = {
  "workspace.briefing": components["schemas"]["WorkspaceBriefingOutput"];
  "campaigns.list": components["schemas"]["CampaignsListOutput"];
  "campaign.inspect": components["schemas"]["CampaignInspectOutput"];
  "sending.inspect": components["schemas"]["SendingInspectOutput"];
  "replies.list": components["schemas"]["RepliesListOutput"];
  "pipeline.inspect": components["schemas"]["PipelineInspectOutput"];
  "company.timeline": components["schemas"]["CompanyTimelineOutput"];
};

export type AgentToolPolicy = components["schemas"]["ReadToolPolicy"];
export type AgentToolEvidence = components["schemas"]["AgentToolEvidence"];
export type AgentToolConsistency = components["schemas"]["AgentToolConsistency"];
export type AgentToolError = components["schemas"]["AgentToolError"];

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
