import {
  createDmfasterClient,
  DmfasterSdkError,
  type AgentToolInputMap,
  type AgentToolName,
  type AgentToolResult,
  type CampaignStatus,
  type DmfasterClientOptions,
} from "@dmfaster/sdk";
import {
  AgentAuthError,
  acquireLoginLock as acquireSystemLoginLock,
  beginDeviceAuthorization,
  createBrowserOpener,
  createSystemCredentialStore,
  credentialSourceLabel,
  getRemoteAuthStatus,
  pollDeviceAuthorization,
  revokeRemoteCredential,
  type CredentialStore,
  type DeviceAuthAdapters,
  type AcquireLoginLock,
  type OpenBrowser,
} from "@dmfaster/local-auth";

import { resolveCliConfig, type ResolvedCliConfig } from "./config.ts";

export const CLI_VERSION = "0.1.0";

const HELP = `DM Faster CLI ${CLI_VERSION}

Usage:
  dmfaster [--json] <command>

Configuration:
  config show
  auth login
  auth status
  auth logout

Read-only commands:
  workspace briefing
  campaigns list [--status STATUS] [--limit N]
  campaign inspect [CAMPAIGN_ID]
  sending inspect [CAMPAIGN_ID]
  replies list [CAMPAIGN_ID] [--limit N] [--query TEXT]
  pipeline inspect [CAMPAIGN_ID]
  company timeline CAMPAIGN_ID COMPANY_OUTREACH_ID

Environment:
  DMFASTER_TOKEN       Scoped token override for headless use and CI
  DMFASTER_API_URL     Compatible Agent API base URL (default: https://app.dmfaster.com)
  DMFASTER_CONFIG      Optional config JSON path

Run 'dmfaster auth login' for secure browser sign-in. Tokens are stored in the OS
credential store, never in the config file. All agent tools are read-only.`;

type Output = {
  write(value: string): unknown;
};

type AgentInvoker = {
  invoke<Name extends AgentToolName>(
    tool: Name,
    input: AgentToolInputMap[Name],
  ): Promise<AgentToolResult>;
};

export type CliContext = {
  stdout?: Output;
  stderr?: Output;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  resolveConfig?: () => Promise<ResolvedCliConfig>;
  createClient?: (options: DmfasterClientOptions) => AgentInvoker;
  credentialStore?: CredentialStore;
  openBrowser?: OpenBrowser;
  fetch?: typeof globalThis.fetch;
  deviceAuthAdapters?: Omit<DeviceAuthAdapters, "fetch">;
  acquireLoginLock?: AcquireLoginLock;
};

class UsageError extends Error {}

function line(output: Output, value: string) {
  output.write(`${value}\n`);
}

function parseInteger(value: string | undefined, option: string, maximum: number) {
  if (!value || !/^\d+$/.test(value)) {
    throw new UsageError(`${option} requires a positive integer.`);
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) {
    throw new UsageError(`${option} must be from 1 to ${maximum}.`);
  }
  return parsed;
}

function requireNoArguments(args: string[], command: string) {
  if (args.length > 0) throw new UsageError(`${command} does not accept additional arguments.`);
}

function parseOptionalCampaignId(args: string[], command: string) {
  if (args.length > 1) throw new UsageError(`${command} accepts at most one campaign reference.`);
  const campaignId = args[0]?.trim();
  if (campaignId && campaignId.length > 160) {
    throw new UsageError("Campaign identifiers cannot exceed 160 characters.");
  }
  return campaignId ? { campaignId } : {};
}

function parseCampaignList(args: string[]): AgentToolInputMap["campaigns.list"] {
  const input: AgentToolInputMap["campaigns.list"] = {};
  const statuses: CampaignStatus[] = ["Draft", "Queued", "Running", "Paused", "Cooldown", "Completed"];
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--status") {
      const value = args[index + 1];
      const status = statuses.find((candidate) => candidate.toLowerCase() === value?.toLowerCase());
      if (!status) throw new UsageError(`--status must be one of: ${statuses.join(", ")}.`);
      input.status = status;
      index += 1;
    } else if (option === "--limit") {
      input.limit = parseInteger(args[index + 1], "--limit", 25);
      index += 1;
    } else {
      throw new UsageError(`Unknown campaigns list option: ${option || "(empty)"}.`);
    }
  }
  return input;
}

function parseRepliesList(args: string[]): AgentToolInputMap["replies.list"] {
  const input: AgentToolInputMap["replies.list"] = {};
  let positionalCampaignId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--limit") {
      input.limit = parseInteger(args[index + 1], "--limit", 20);
      index += 1;
    } else if (option === "--query") {
      const query = args[index + 1]?.trim();
      if (!query || query.startsWith("--")) throw new UsageError("--query requires search text.");
      if (query.length > 120) throw new UsageError("--query cannot exceed 120 characters.");
      input.query = query;
      index += 1;
    } else if (option?.startsWith("--")) {
      throw new UsageError(`Unknown replies list option: ${option}.`);
    } else if (option) {
      if (positionalCampaignId) {
        throw new UsageError("replies list accepts at most one campaign identifier.");
      }
      if (option.length > 160) throw new UsageError("Campaign identifiers cannot exceed 160 characters.");
      positionalCampaignId = option;
    } else {
      throw new UsageError(`Unknown replies list option: ${option || "(empty)"}.`);
    }
  }
  if (positionalCampaignId) input.campaignId = positionalCampaignId;
  return input;
}

function parseCompanyTimeline(args: string[]): AgentToolInputMap["company.timeline"] {
  if (args.length !== 2) {
    throw new UsageError("company timeline requires CAMPAIGN_ID and COMPANY_OUTREACH_ID.");
  }
  const campaignId = args[0]?.trim() || "";
  const companyOutreachId = args[1]?.trim() || "";
  if (!campaignId || !companyOutreachId) {
    throw new UsageError("company timeline identifiers cannot be empty.");
  }
  if (campaignId.length > 160 || companyOutreachId.length > 160) {
    throw new UsageError("company timeline identifiers cannot exceed 160 characters.");
  }
  return { campaignId, companyOutreachId };
}

function commandFromArgs(args: string[]): {
  tool: AgentToolName;
  input: AgentToolInputMap[AgentToolName];
} {
  const [group, action, ...rest] = args;
  if (group === "workspace" && action === "briefing") {
    requireNoArguments(rest, "workspace briefing");
    return { tool: "workspace.briefing", input: {} };
  }
  if (group === "campaigns" && action === "list") {
    return { tool: "campaigns.list", input: parseCampaignList(rest) };
  }
  if (group === "campaign" && action === "inspect") {
    return { tool: "campaign.inspect", input: parseOptionalCampaignId(rest, "campaign inspect") };
  }
  if (group === "sending" && action === "inspect") {
    return { tool: "sending.inspect", input: parseOptionalCampaignId(rest, "sending inspect") };
  }
  if (group === "replies" && action === "list") {
    return { tool: "replies.list", input: parseRepliesList(rest) };
  }
  if (group === "pipeline" && action === "inspect") {
    return { tool: "pipeline.inspect", input: parseOptionalCampaignId(rest, "pipeline inspect") };
  }
  if (group === "company" && action === "timeline") {
    return { tool: "company.timeline", input: parseCompanyTimeline(rest) };
  }
  throw new UsageError(`Unknown command: ${args.join(" ") || "(none)"}. Run dmfaster --help.`);
}

function missingTokenMessage(config: ResolvedCliConfig) {
  return [
    "DM Faster is not signed in.",
    "Run `dmfaster auth login`, or set DMFASTER_TOKEN for headless CI.",
    config.credentialStoreError || "Plaintext tokens are never accepted in the config file.",
  ].join(" ");
}

function publicIdentity(identity: Awaited<ReturnType<typeof getRemoteAuthStatus>>) {
  return {
    workspace: identity.workspace,
    user: identity.user,
    credential: identity.credential,
  };
}

function authAdapters(context: CliContext): DeviceAuthAdapters {
  return {
    ...(context.deviceAuthAdapters ?? {}),
    ...(context.fetch ? { fetch: context.fetch } : {}),
  };
}

async function runAuthLogin(input: {
  config: ResolvedCliConfig;
  context: CliContext;
  stdout: Output;
  stderr: Output;
}) {
  if (input.config.tokenSource === "DMFASTER_TOKEN") {
    throw new UsageError(
      "DMFASTER_TOKEN is set and overrides secure browser login. Unset it before running `dmfaster auth login`.",
    );
  }
  if (input.config.token) {
    throw new UsageError(
      "DM Faster is already signed in on this API origin. Run `dmfaster auth status`, or `dmfaster auth logout` before replacing the credential.",
    );
  }
  if (input.config.credentialStoreError) {
    throw new UsageError(input.config.credentialStoreError);
  }

  const store = input.context.credentialStore ?? createSystemCredentialStore();
  const acquireLock = input.context.acquireLoginLock ?? ((baseUrl: string) => acquireSystemLoginLock({
    baseUrl,
    ...(input.context.env ? { env: input.context.env } : {}),
    ...(input.context.homeDirectory ? { homeDirectory: input.context.homeDirectory } : {}),
  }));
  const loginLock = await acquireLock(input.config.baseUrl);
  const result = await (async () => {
    try {
      // Re-read under the cross-process lock. Another CLI may have completed
      // between initial config resolution and lock acquisition.
      if (await store.get(input.config.baseUrl)) {
        throw new UsageError(
          "DM Faster is already signed in on this API origin. Run `dmfaster auth status`, or `dmfaster auth logout` before replacing the credential.",
        );
      }

      const authorization = await beginDeviceAuthorization({
        baseUrl: input.config.baseUrl,
        adapters: authAdapters(input.context),
      });
      line(input.stdout, JSON.stringify({
        event: "authorization_required",
        confirmationCode: authorization.confirmationCode,
        verificationUrl: authorization.verificationUrl,
        expiresIn: authorization.expiresIn,
      }));
      line(input.stderr, `Confirmation code: ${authorization.confirmationCode}`);
      line(input.stderr, "Check that this code matches in the browser before approving.");
      line(input.stderr, `Open: ${authorization.verificationUrl}`);

      const openBrowser = input.context.openBrowser ?? createBrowserOpener();
      try {
        await openBrowser(authorization.verificationUrl);
      } catch (error) {
        line(
          input.stderr,
          `warning: ${error instanceof Error ? error.message : "Could not open the browser."}`,
        );
      }
      line(input.stderr, "Waiting for browser approval…");

      const authorized = await pollDeviceAuthorization({
        baseUrl: input.config.baseUrl,
        authorization,
        adapters: authAdapters(input.context),
      });

      try {
        await loginLock.assertOwned();
      } catch (lockError) {
        try {
          await revokeRemoteCredential({
            baseUrl: input.config.baseUrl,
            token: authorized.accessToken,
            ...(input.context.fetch ? { fetch: input.context.fetch } : {}),
          });
        } catch {
          // The lock failure remains the actionable error. The newly issued
          // remote credential has not been persisted and cleanup was attempted.
        }
        throw lockError;
      }

      try {
        await store.set(input.config.baseUrl, authorized.accessToken);
      } catch (storeError) {
        try {
          await revokeRemoteCredential({
            baseUrl: input.config.baseUrl,
            token: authorized.accessToken,
            ...(input.context.fetch ? { fetch: input.context.fetch } : {}),
          });
        } catch {
          // The original secure-storage error is more actionable. No secret is
          // included in either failure, and remote cleanup has been attempted.
        }
        throw storeError;
      }
      return authorized;
    } finally {
      await loginLock.release();
    }
  })();

  line(input.stdout, JSON.stringify({
    event: "authenticated",
    status: "authenticated",
    verifiedRemotely: true,
    credentialSource: credentialSourceLabel(store.kind),
    baseUrl: input.config.baseUrl,
    ...publicIdentity(result),
  }));
  return 0;
}

async function runAuthStatus(input: {
  config: ResolvedCliConfig;
  context: CliContext;
  stdout: Output;
  stderr: Output;
}) {
  if (!input.config.token) {
    line(input.stdout, JSON.stringify({
      status: "not_authenticated",
      verifiedRemotely: false,
      credentialSource: null,
      baseUrl: input.config.baseUrl,
    }, null, 2));
    line(input.stderr, missingTokenMessage(input.config));
    return 1;
  }

  try {
    const identity = await getRemoteAuthStatus({
      baseUrl: input.config.baseUrl,
      token: input.config.token,
      ...(input.context.fetch ? { fetch: input.context.fetch } : {}),
    });
    line(input.stdout, JSON.stringify({
      status: "authenticated",
      verifiedRemotely: true,
      credentialSource: input.config.tokenSource,
      baseUrl: input.config.baseUrl,
      ...publicIdentity(identity),
    }, null, 2));
    return 0;
  } catch (error) {
    const invalid = error instanceof AgentAuthError
      && (error.code === "unauthorized" || error.code === "workspace_access_denied");
    line(input.stdout, JSON.stringify({
      status: invalid ? "invalid" : "unavailable",
      verifiedRemotely: invalid,
      credentialSource: input.config.tokenSource,
      baseUrl: input.config.baseUrl,
    }, null, 2));
    line(input.stderr, `error: ${error instanceof Error ? error.message : "Could not verify DM Faster login."}`);
    return 1;
  }
}

async function runAuthLogout(input: {
  config: ResolvedCliConfig;
  context: CliContext;
  stdout: Output;
}) {
  if (!input.config.token) {
    if (input.config.credentialStoreError) throw new UsageError(input.config.credentialStoreError);
    line(input.stdout, JSON.stringify({ status: "not_authenticated", revoked: false }, null, 2));
    return 0;
  }

  try {
    await revokeRemoteCredential({
      baseUrl: input.config.baseUrl,
      token: input.config.token,
      ...(input.context.fetch ? { fetch: input.context.fetch } : {}),
    });
  } catch (error) {
    // An unauthorized token is already unusable remotely, so it is safe to
    // remove a matching stored credential. Other failures remain retryable.
    if (!(error instanceof AgentAuthError) || error.code !== "unauthorized") throw error;
  }

  if (input.config.tokenSource === "DMFASTER_TOKEN") {
    line(input.stdout, JSON.stringify({
      status: "revoked",
      revoked: true,
      localCredentialRemoved: false,
      credentialSource: "DMFASTER_TOKEN",
      actionRequired: "Unset DMFASTER_TOKEN in the parent process.",
    }, null, 2));
    return 0;
  }

  const store = input.context.credentialStore ?? createSystemCredentialStore();
  await store.delete(input.config.baseUrl);
  line(input.stdout, JSON.stringify({
    status: "logged_out",
    revoked: true,
    localCredentialRemoved: true,
    credentialSource: input.config.tokenSource,
  }, null, 2));
  return 0;
}

export async function runCli(argv: string[], context: CliContext = {}) {
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;
  const args = argv.filter((value) => value !== "--json");

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    line(stdout, HELP);
    return 0;
  }
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-V")) {
    line(stdout, CLI_VERSION);
    return 0;
  }

  try {
    const credentialStore = context.credentialStore ?? createSystemCredentialStore();
    const config = context.resolveConfig
      ? await context.resolveConfig()
      : await resolveCliConfig({
          ...(context.env ? { env: context.env } : {}),
          ...(context.homeDirectory ? { homeDirectory: context.homeDirectory } : {}),
          credentialStore,
        });

    if (args[0] === "config" && args[1] === "show") {
      requireNoArguments(args.slice(2), "config show");
      line(stdout, JSON.stringify({
        baseUrl: config.baseUrl,
        baseUrlSource: config.baseUrlSource,
        tokenConfigured: Boolean(config.token),
        tokenSource: config.tokenSource,
        secureCredentialStoreAvailable: !config.credentialStoreError,
        configPath: config.configPath,
      }, null, 2));
      return 0;
    }
    if (args[0] === "auth" && args[1] === "login") {
      requireNoArguments(args.slice(2), "auth login");
      return await runAuthLogin({ config, context: { ...context, credentialStore }, stdout, stderr });
    }
    if (args[0] === "auth" && args[1] === "status") {
      requireNoArguments(args.slice(2), "auth status");
      return await runAuthStatus({ config, context, stdout, stderr });
    }
    if (args[0] === "auth" && args[1] === "logout") {
      requireNoArguments(args.slice(2), "auth logout");
      return await runAuthLogout({ config, context: { ...context, credentialStore }, stdout });
    }

    const command = commandFromArgs(args);
    if (!config.token) throw new UsageError(missingTokenMessage(config));
    const createClient = context.createClient ?? createDmfasterClient;
    const client = createClient({ baseUrl: config.baseUrl, token: config.token });
    const result = await client.invoke(command.tool, command.input as never);
    line(stdout, JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof UsageError) {
      line(stderr, `error: ${error.message}`);
      return 2;
    }
    if (error instanceof DmfasterSdkError) {
      line(stderr, `error: ${error.message}`);
      return 1;
    }
    line(stderr, `error: ${error instanceof Error ? error.message : "Unexpected CLI failure."}`);
    return 1;
  }
}
