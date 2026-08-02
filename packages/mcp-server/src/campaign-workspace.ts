import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { CAMPAIGN_WORKSPACE_HTML } from "./campaign-workspace-html.ts";
import { campaignIdSchema, campaignStateSchema } from "./tools.ts";

export const CAMPAIGN_WORKSPACE_TOOL_NAME = "campaign_workspace";
export const CAMPAIGN_WORKSPACE_RESOURCE_URI = "ui://dmfaster/campaign-workspace/v1.html";
export const MCP_APP_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

export const campaignWorkspaceInputSchema = z.object({
  state: campaignStateSchema,
  campaignId: campaignIdSchema.optional().describe(
    "Optional DM Faster campaign identifier returned by campaign_prepare or campaign_inspect.",
  ),
}).strict();

const resourceUiMetadata = Object.freeze({
  csp: {
    connectDomains: [] as string[],
    resourceDomains: [] as string[],
    frameDomains: [] as string[],
  },
  prefersBorder: true,
});

function presentationResult(input: z.infer<typeof campaignWorkspaceInputSchema>) {
  const structuredContent = {
    version: 1,
    view: "dmfaster.campaign_workspace",
    state: input.state,
    campaignId: input.campaignId ?? null,
    actions: {
      validate: "campaign_validate",
      preview: "audience_preview",
      preparePrivateDraft: "campaign_prepare",
      requestLaunchApproval: "campaign_launch_preflight",
    },
    safety: {
      preparationStartsSending: false,
      launchRequiresHumanApproval: true,
      exactAudienceRequiredForPreparation: true,
    },
  };

  return {
    content: [{
      type: "text" as const,
      text: [
        `Campaign workspace ready for ${input.state.profile.businessName || "this business"}.`,
        "A compatible MCP Apps host can render the interactive editor.",
        "In a headless host, keep using the structured state and the 16 DM Faster domain tools directly.",
        "Preparing creates only a private disabled draft; launching still requires the owner-approved preflight flow.",
      ].join(" "),
    }],
    structuredContent,
  };
}

export function registerCampaignWorkspace(server: McpServer) {
  server.registerResource(
    "DM Faster campaign workspace",
    CAMPAIGN_WORKSPACE_RESOURCE_URI,
    {
      title: "DM Faster campaign workspace",
      description: "Interactive campaign planning, exact audience preview, and safe private-draft preparation.",
      mimeType: MCP_APP_RESOURCE_MIME_TYPE,
      _meta: {
        ui: resourceUiMetadata,
        "openai/widgetCSP": {
          connect_domains: [],
          resource_domains: [],
        },
        "openai/widgetPrefersBorder": true,
      },
    },
    async () => ({
      contents: [{
        uri: CAMPAIGN_WORKSPACE_RESOURCE_URI,
        mimeType: MCP_APP_RESOURCE_MIME_TYPE,
        text: CAMPAIGN_WORKSPACE_HTML,
        _meta: {
          ui: resourceUiMetadata,
          "openai/widgetCSP": {
            connect_domains: [],
            resource_domains: [],
          },
          "openai/widgetPrefersBorder": true,
        },
      }],
    }),
  );

  server.registerTool(
    CAMPAIGN_WORKSPACE_TOOL_NAME,
    {
      title: "Open campaign workspace",
      description: [
        "Render a complete DM Faster campaign state as an interactive workspace in MCP Apps hosts.",
        "Use after constructing or revising the complete state; headless hosts receive the same state as structured content.",
        "This presentation tool does not read or change workspace data.",
      ].join(" "),
      inputSchema: campaignWorkspaceInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: CAMPAIGN_WORKSPACE_RESOURCE_URI,
          visibility: ["model"],
        },
        "ui/resourceUri": CAMPAIGN_WORKSPACE_RESOURCE_URI,
        "openai/outputTemplate": CAMPAIGN_WORKSPACE_RESOURCE_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Opening campaign workspace…",
        "openai/toolInvocation/invoked": "Campaign workspace ready",
      },
    },
    async (input) => presentationResult(input),
  );
}
