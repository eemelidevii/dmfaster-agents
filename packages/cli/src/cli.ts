import {
  createDmfasterClient,
  DmfasterHttpError,
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
  type DmfasterAgentAccessProfile,
  type AcquireLoginLock,
  type OpenBrowser,
} from "@dmfaster/local-auth";
import { readFile } from "node:fs/promises";

import { resolveCliConfig, type ResolvedCliConfig } from "./config.ts";

export const CLI_VERSION = "1.0.0";

const HELP = `DM Faster CLI ${CLI_VERSION}

Usage:
  dmfaster [--json] <command>

Configuration:
  config show
  auth login [--access read|plan|draft|full]
  auth status
  auth logout

Workspace reads:
  workspace briefing
  campaigns list [--status STATUS] [--limit N]
  campaign inspect [CAMPAIGN_ID]
  sending inspect [CAMPAIGN_ID]
  replies list [CAMPAIGN_ID] [--limit N] [--query TEXT]
  pipeline inspect [CAMPAIGN_ID]
  company timeline CAMPAIGN_ID COMPANY_OUTREACH_ID

Campaign planning and drafts:
  industry lookup QUERY [--version 2008|2025] [--language en|fi]
  campaign validate --state FILE
  audience preview --state FILE [--sample-size N]
  list prepare --state FILE [--idempotency-key KEY]
  campaign prepare --state FILE [--idempotency-key KEY]

Human-approved campaign controls:
  campaign launch preflight CAMPAIGN_ID --idempotency-key KEY
  campaign launch CAMPAIGN_ID --idempotency-key KEY --authorization-id ID
  campaign pause preflight CAMPAIGN_ID --idempotency-key KEY
  campaign pause CAMPAIGN_ID --idempotency-key KEY --authorization-id ID

Agent quick start:
  Begin with 'workspace briefing --json'. For a new campaign, create one complete
  state and run validate, exact audience preview, then private draft preparation.
  Launch preflight may return setup_required; show setup.setupUrl to the user and
  repeat setup.resume exactly after browser setup. Never treat setup or preparation
  as launch approval.

Environment:
  DMFASTER_TOKEN       Scoped token override for headless use and CI
  DMFASTER_API_URL     Compatible Agent API base URL (default: https://app.dmfaster.com)
  DMFASTER_CONFIG      Optional config JSON path

Run 'dmfaster auth login' for secure browser sign-in. Tokens are stored in the OS
credential store, never in the config file. Launch and pause require a separate
short-lived approval in DM Faster for one exact campaign version.`;

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
  readTextFile?: (path: string) => Promise<string>;
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

const AUTH_ACCESS_PROFILES = ["read", "plan", "draft", "full"] as const;

function parseAuthLoginAccess(args: string[]): DmfasterAgentAccessProfile {
  let access: DmfasterAgentAccessProfile = "full";
  let seen = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index] || "";
    let candidate: string | undefined;
    if (option === "--access") {
      candidate = args[index + 1];
      index += 1;
    } else if (option.startsWith("--access=")) {
      candidate = option.slice("--access=".length);
    } else {
      throw new UsageError(`Unknown auth login option: ${option || "(empty)"}.`);
    }
    if (seen) throw new UsageError("--access can be provided only once.");
    if (!AUTH_ACCESS_PROFILES.includes(candidate as DmfasterAgentAccessProfile)) {
      throw new UsageError(`--access must be one of: ${AUTH_ACCESS_PROFILES.join(", ")}.`);
    }
    access = candidate as DmfasterAgentAccessProfile;
    seen = true;
  }
  return access;
}

function parseOptionalCampaignId(args: string[], command: string) {
  if (args.length > 1) throw new UsageError(`${command} accepts at most one campaign reference.`);
  if (args.length === 1 && !args[0]?.trim()) {
    throw new UsageError("Campaign identifiers cannot be empty.");
  }
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
      const campaignId = option.trim();
      if (!campaignId) throw new UsageError("Campaign identifiers cannot be empty.");
      if (campaignId.length > 160) throw new UsageError("Campaign identifiers cannot exceed 160 characters.");
      positionalCampaignId = campaignId;
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

function parseIdempotencyKey(value: string | undefined) {
  const normalized = value?.trim() || "";
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(normalized)) {
    throw new UsageError(
      "--idempotency-key requires 1 to 160 letters, numbers, dots, colons, underscores, or dashes.",
    );
  }
  return normalized;
}

function parseIndustryLookup(args: string[]): AgentToolInputMap["industry.lookup"] {
  const queryParts: string[] = [];
  let version: "2008" | "2025" | undefined;
  let language: "en" | "fi" | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--version") {
      const candidate = args[index + 1];
      if (candidate !== "2008" && candidate !== "2025") {
        throw new UsageError("--version must be 2008 or 2025.");
      }
      version = candidate;
      index += 1;
    } else if (value === "--language") {
      const candidate = args[index + 1];
      if (candidate !== "en" && candidate !== "fi") {
        throw new UsageError("--language must be en or fi.");
      }
      language = candidate;
      index += 1;
    } else if (value?.startsWith("--")) {
      throw new UsageError(`Unknown industry lookup option: ${value}.`);
    } else if (value) {
      queryParts.push(value);
    }
  }
  const query = queryParts.join(" ").trim();
  if (!query || query.length > 800) {
    throw new UsageError("industry lookup requires a query of at most 800 characters.");
  }
  return { query, ...(version ? { version } : {}), ...(language ? { language } : {}) };
}

async function parseCampaignStateFile(path: string, context: CliContext) {
  const read = context.readTextFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  let source: string;
  try {
    source = await read(path);
  } catch (cause) {
    throw new UsageError(
      `Could not read campaign state file ${path}: ${cause instanceof Error ? cause.message : "read failed"}`,
    );
  }
  if (Buffer.byteLength(source, "utf8") > 64 * 1024) {
    throw new UsageError("Campaign state files cannot exceed 64 KiB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new UsageError("Campaign state must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError("Campaign state must be a JSON object.");
  }
  const candidate = parsed as Record<string, unknown>;
  const state = candidate.state && typeof candidate.state === "object"
    ? candidate.state
    : candidate;
  return state;
}

async function parseStateCommand(
  args: string[],
  context: CliContext,
): Promise<{
  state: AgentToolInputMap["campaign.validate"]["state"];
  sampleSize?: number;
  idempotencyKey?: string;
}> {
  let statePath = "";
  let sampleSize: number | undefined;
  let idempotencyKeyValue: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--state") {
      statePath = args[index + 1]?.trim() || "";
      index += 1;
    } else if (value === "--sample-size") {
      sampleSize = parseInteger(args[index + 1], "--sample-size", 25);
      index += 1;
    } else if (value === "--idempotency-key") {
      idempotencyKeyValue = parseIdempotencyKey(args[index + 1]);
      index += 1;
    } else {
      throw new UsageError(`Unknown campaign state option: ${value || "(empty)"}.`);
    }
  }
  if (!statePath) throw new UsageError("--state FILE is required.");
  const state = await parseCampaignStateFile(statePath, context) as AgentToolInputMap[
    "campaign.validate"
  ]["state"];
  return {
    state,
    ...(sampleSize ? { sampleSize } : {}),
    ...(idempotencyKeyValue ? { idempotencyKey: idempotencyKeyValue } : {}),
  };
}

function parseCampaignAction(
  args: string[],
  options: { execute: boolean },
) {
  const campaignIdValue = args[0]?.trim() || "";
  if (!campaignIdValue || campaignIdValue.length > 160 || campaignIdValue.startsWith("--")) {
    throw new UsageError("A campaign identifier of at most 160 characters is required.");
  }
  let idempotencyKeyValue = "";
  let authorizationIdValue = "";
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--idempotency-key") {
      idempotencyKeyValue = parseIdempotencyKey(args[index + 1]);
      index += 1;
    } else if (value === "--authorization-id") {
      const candidate = args[index + 1]?.trim() || "";
      if (!/^agent_action_[a-f0-9]{32}$/.test(candidate)) {
        throw new UsageError("--authorization-id must be returned by the matching preflight.");
      }
      authorizationIdValue = candidate;
      index += 1;
    } else {
      throw new UsageError(`Unknown campaign action option: ${value || "(empty)"}.`);
    }
  }
  if (!idempotencyKeyValue) {
    throw new UsageError("--idempotency-key KEY is required.");
  }
  if (options.execute && !authorizationIdValue) {
    throw new UsageError("--authorization-id ID is required after human approval.");
  }
  return {
    campaignId: campaignIdValue,
    idempotencyKey: idempotencyKeyValue,
    ...(options.execute ? { authorizationId: authorizationIdValue } : {}),
  };
}

async function commandFromArgs(args: string[], context: CliContext): Promise<{
  tool: AgentToolName;
  input: AgentToolInputMap[AgentToolName];
}> {
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
  if (group === "industry" && action === "lookup") {
    return { tool: "industry.lookup", input: parseIndustryLookup(rest) };
  }
  if (group === "campaign" && action === "validate") {
    const input = await parseStateCommand(rest, context);
    return { tool: "campaign.validate", input: { state: input.state } };
  }
  if (group === "audience" && action === "preview") {
    const input = await parseStateCommand(rest, context);
    return {
      tool: "audience.preview",
      input: { state: input.state, ...(input.sampleSize ? { sampleSize: input.sampleSize } : {}) },
    };
  }
  if (group === "list" && action === "prepare") {
    const input = await parseStateCommand(rest, context);
    return { tool: "list.prepare", input };
  }
  if (group === "campaign" && action === "prepare") {
    const input = await parseStateCommand(rest, context);
    return { tool: "campaign.prepare", input };
  }
  if (group === "campaign" && action === "launch" && rest[0] === "preflight") {
    return {
      tool: "campaign.launch.preflight",
      input: parseCampaignAction(rest.slice(1), { execute: false }),
    };
  }
  if (group === "campaign" && action === "launch") {
    return {
      tool: "campaign.launch",
      input: parseCampaignAction(rest, { execute: true }) as AgentToolInputMap["campaign.launch"],
    };
  }
  if (group === "campaign" && action === "pause" && rest[0] === "preflight") {
    return {
      tool: "campaign.pause.preflight",
      input: parseCampaignAction(rest.slice(1), { execute: false }),
    };
  }
  if (group === "campaign" && action === "pause") {
    return {
      tool: "campaign.pause",
      input: parseCampaignAction(rest, { execute: true }) as AgentToolInputMap["campaign.pause"],
    };
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

function publicClientError(error: DmfasterSdkError | AgentAuthError) {
  const httpError = error instanceof DmfasterHttpError ? error : null;
  const authError = error instanceof AgentAuthError ? error : null;
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(typeof httpError?.retryable === "boolean" ? { retryable: httpError.retryable } : {}),
      ...(httpError?.requestId ? { requestId: httpError.requestId } : {}),
      ...(typeof (httpError?.retryAfterSeconds ?? authError?.retryAfterSeconds) === "number"
        ? { retryAfterSeconds: httpError?.retryAfterSeconds ?? authError?.retryAfterSeconds }
        : {}),
      ...(httpError?.details ? { details: httpError.details } : {}),
      ...(typeof (httpError?.status ?? authError?.status) === "number"
        ? { status: httpError?.status ?? authError?.status }
        : {}),
    },
  };
}

function printClientError(
  output: Output,
  error: DmfasterSdkError | AgentAuthError,
  jsonOutput: boolean,
) {
  const body = publicClientError(error);
  if (jsonOutput) {
    line(output, JSON.stringify(body, null, 2));
    return;
  }
  const metadata = body.error;
  const context = [
    `code: ${metadata.code}`,
    ...(typeof metadata.retryable === "boolean" ? [`retryable: ${metadata.retryable}`] : []),
    ...(metadata.requestId ? [`request: ${metadata.requestId}`] : []),
    ...(typeof metadata.retryAfterSeconds === "number"
      ? [`retry after: ${metadata.retryAfterSeconds}s`]
      : []),
  ];
  line(output, `error: ${metadata.message} (${context.join(", ")})`);
}

async function cleanupIssuedRemoteCredential(input: {
  baseUrl: string;
  token: string;
  context: CliContext;
  stderr: Output;
}) {
  const cleanupSleep = input.context.deviceAuthAdapters?.sleep
    ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await revokeRemoteCredential({
        baseUrl: input.baseUrl,
        token: input.token,
        ...(input.context.fetch ? { fetch: input.context.fetch } : {}),
      });
      return true;
    } catch (error) {
      if (error instanceof AgentAuthError && error.code === "unauthorized") {
        return true;
      }
      lastError = error;
      if (attempt < 2) await cleanupSleep(250 * (2 ** attempt));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : "Remote revocation was unavailable.";
  line(
    input.stderr,
    `warning: The unused remote DM Faster credential could not be revoked after 3 attempts. Revoke the new CLI session from Agent access settings. ${detail}`,
  );
  return false;
}

async function runAuthLogin(input: {
  config: ResolvedCliConfig;
  context: CliContext;
  stdout: Output;
  stderr: Output;
  access: DmfasterAgentAccessProfile;
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
    let persisted = false;
    let failed = false;
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
        access: input.access,
        adapters: authAdapters(input.context),
      });
      line(input.stdout, JSON.stringify({
        event: "authorization_required",
        confirmationCode: authorization.confirmationCode,
        verificationUrl: authorization.verificationUrl,
        expiresIn: authorization.expiresIn,
        requestedAccess: input.access,
      }));
      line(input.stderr, `Confirmation code: ${authorization.confirmationCode}`);
      line(input.stderr, `Requested access: ${input.access}`);
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
        await cleanupIssuedRemoteCredential({
          baseUrl: input.config.baseUrl,
          token: authorized.accessToken,
          context: input.context,
          stderr: input.stderr,
        });
        throw lockError;
      }

      try {
        await store.set(input.config.baseUrl, authorized.accessToken);
      } catch (storeError) {
        await cleanupIssuedRemoteCredential({
          baseUrl: input.config.baseUrl,
          token: authorized.accessToken,
          context: input.context,
          stderr: input.stderr,
        });
        throw storeError;
      }
      persisted = true;
      return authorized;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await loginLock.release();
      } catch (cleanupError) {
        if (persisted) {
          const detail = cleanupError instanceof Error
            ? cleanupError.message
            : "Could not remove the browser-login lock.";
          line(
            input.stderr,
            `warning: Authentication succeeded, but browser-login lock cleanup failed. ${detail}`,
          );
        } else if (!failed) {
          throw cleanupError;
        }
      }
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
    if (error instanceof AgentAuthError) throw error;
    line(input.stderr, `error: ${error instanceof Error ? error.message : "Could not verify DM Faster login."}`);
    return 1;
  }
}

async function runAuthLogout(input: {
  config: ResolvedCliConfig;
  context: CliContext;
  stdout: Output;
  stderr: Output;
}) {
  if (input.config.tokenSource === "DMFASTER_TOKEN") {
    if (!input.config.token) {
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
      if (!(error instanceof AgentAuthError) || error.code !== "unauthorized") throw error;
    }
    line(input.stdout, JSON.stringify({
      status: "revoked",
      revoked: true,
      localCredentialRemoved: false,
      credentialSource: "DMFASTER_TOKEN",
      actionRequired: "Unset DMFASTER_TOKEN in the parent process.",
    }, null, 2));
    return 0;
  }

  if (input.config.credentialStoreError) throw new UsageError(input.config.credentialStoreError);
  const store = input.context.credentialStore ?? createSystemCredentialStore();
  const acquireLock = input.context.acquireLoginLock ?? ((baseUrl: string) => acquireSystemLoginLock({
    baseUrl,
    ...(input.context.env ? { env: input.context.env } : {}),
    ...(input.context.homeDirectory ? { homeDirectory: input.context.homeDirectory } : {}),
  }));
  const loginLock = await acquireLock(input.config.baseUrl);
  let completed = false;
  try {
    const token = await store.get(input.config.baseUrl) ?? input.config.token;
    if (!token) {
      line(input.stdout, JSON.stringify({ status: "not_authenticated", revoked: false }, null, 2));
      completed = true;
      return 0;
    }

    try {
      await revokeRemoteCredential({
        baseUrl: input.config.baseUrl,
        token,
        ...(input.context.fetch ? { fetch: input.context.fetch } : {}),
      });
    } catch (error) {
      // An unauthorized token is already unusable remotely, so it is safe to
      // remove a matching stored credential. Other failures remain retryable.
      if (!(error instanceof AgentAuthError) || error.code !== "unauthorized") throw error;
    }

    await store.delete(input.config.baseUrl);
    line(input.stdout, JSON.stringify({
      status: "logged_out",
      revoked: true,
      localCredentialRemoved: true,
      credentialSource: input.config.tokenSource ?? credentialSourceLabel(store.kind),
    }, null, 2));
    completed = true;
    return 0;
  } finally {
    try {
      await loginLock.release();
    } catch (error) {
      if (!completed) throw error;
      line(
        input.stderr,
        `warning: Logout succeeded, but browser-login lock cleanup failed. ${error instanceof Error ? error.message : "Remove the stale lock before the next login."}`,
      );
    }
  }
}

export async function runCli(argv: string[], context: CliContext = {}) {
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;
  const jsonOutput = argv.includes("--json");
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
      const access = parseAuthLoginAccess(args.slice(2));
      return await runAuthLogin({
        config,
        context: { ...context, credentialStore },
        stdout,
        stderr,
        access,
      });
    }
    if (args[0] === "auth" && args[1] === "status") {
      requireNoArguments(args.slice(2), "auth status");
      return await runAuthStatus({ config, context, stdout, stderr });
    }
    if (args[0] === "auth" && args[1] === "logout") {
      requireNoArguments(args.slice(2), "auth logout");
      return await runAuthLogout({ config, context: { ...context, credentialStore }, stdout, stderr });
    }

    const command = await commandFromArgs(args, context);
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
    if (error instanceof DmfasterSdkError || error instanceof AgentAuthError) {
      printClientError(stderr, error, jsonOutput);
      return 1;
    }
    line(stderr, `error: ${error instanceof Error ? error.message : "Unexpected CLI failure."}`);
    return 1;
  }
}
