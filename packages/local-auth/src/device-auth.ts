import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { hostname as nodeHostname } from "node:os";

import {
  DMFASTER_CREDENTIAL_EXPIRY_DAYS,
  getDmfasterAgentScopes,
  type DmfasterAgentAccessProfile,
} from "./constants.ts";
import { normalizeAgentAccessToken } from "./credential-store.ts";
import { normalizeApiBaseUrl, validateVerificationUrl } from "./url.ts";

const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

type JsonRecord = Record<string, unknown>;

export type AgentCredentialSummary = {
  id: string;
  name: string;
  client: string;
  scopes: string[];
  expiresAt: string;
};

export type AgentIdentity = {
  credential: AgentCredentialSummary;
  workspace: { id: string; name: string; email?: string };
  user: { id: string; name: string; email?: string };
};

export type DeviceAuthorization = {
  confirmationCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
};

type PendingDeviceAuthorization = DeviceAuthorization & {
  deviceCode: string;
  codeVerifier: string;
};

export type DeviceAuthorizationResult = AgentIdentity & {
  accessToken: string;
  tokenType: "Bearer";
};

export type DeviceAuthAdapters = {
  fetch?: typeof globalThis.fetch;
  randomBytes?: (size: number) => Buffer;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  hostname?: () => string;
};

export class AgentAuthError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: string,
    message: string,
    status: number | null = null,
    options?: ErrorOptions & { retryAfterSeconds?: number | null },
  ) {
    super(message, options);
    this.name = "AgentAuthError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = options?.retryAfterSeconds ?? null;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record: JsonRecord, key: string, description: string, maxLength = 4096) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) {
    throw new AgentAuthError("invalid_response", `DM Faster returned an invalid ${description}.`);
  }
  return value.trim();
}

function optionalString(record: JsonRecord, key: string, maxLength = 4096) {
  const value = record[key];
  return typeof value === "string" && value.trim() && value.length <= maxLength && !/[\r\n\0]/.test(value)
    ? value.trim()
    : undefined;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : fallback;
}

function parseRetryAfterSeconds(value: string | null, now = Date.now()) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    return Number.isSafeInteger(seconds) && seconds >= 0
      ? Math.min(seconds, 24 * 60 * 60)
      : null;
  }
  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt)
    ? Math.min(24 * 60 * 60, Math.max(0, Math.ceil((retryAt - now) / 1_000)))
    : null;
}

function parseErrorCode(body: unknown) {
  if (!isRecord(body)) return "request_failed";
  if (typeof body.error === "string") return body.error;
  if (isRecord(body.error) && typeof body.error.code === "string") return body.error.code;
  if (typeof body.code === "string") return body.code;
  return "request_failed";
}

function errorForResponse(response: Response, body: unknown, now = Date.now()) {
  const status = response.status;
  const code = parseErrorCode(body);
  if (status === 401 || code === "unauthorized") {
    return new AgentAuthError("unauthorized", "The saved DM Faster login is no longer valid.", status);
  }
  if (code === "access_denied") {
    return new AgentAuthError("access_denied", "DM Faster sign-in was denied in the browser.", status);
  }
  if (status === 403 || code === "workspace_access_denied") {
    return new AgentAuthError(
      "workspace_access_denied",
      "The saved DM Faster login no longer has access to its workspace.",
      status,
    );
  }
  if (code === "expired_token") {
    return new AgentAuthError("expired_token", "DM Faster sign-in timed out. Run `dmfaster auth login` again.", status);
  }
  if (code === "invalid_grant") {
    return new AgentAuthError("invalid_grant", "DM Faster could not complete this sign-in. Start a new login.", status);
  }
  if (code === "credential_limit") {
    return new AgentAuthError(
      "credential_limit",
      "DM Faster has reached the active agent-session limit. Revoke an old session and try again.",
      status,
    );
  }
  if (status === 429 || code === "rate_limited") {
    return new AgentAuthError(
      "rate_limited",
      "DM Faster temporarily rate-limited authentication.",
      status,
      { retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after"), now) },
    );
  }
  return new AgentAuthError("request_failed", `DM Faster authentication failed with HTTP ${status}.`, status);
}

async function readJson(response: Response) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new AgentAuthError("invalid_response", "DM Faster returned an oversized authentication response.");
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new AgentAuthError("invalid_response", "DM Faster returned invalid authentication JSON.", null, { cause });
  }
}

async function authFetch(
  url: string,
  init: RequestInit,
  fetchImplementation: typeof globalThis.fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_HTTP_TIMEOUT_MS);
  try {
    return await fetchImplementation(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new AgentAuthError("request_timeout", "DM Faster authentication request timed out.", null, { cause });
    }
    if (cause instanceof AgentAuthError) throw cause;
    throw new AgentAuthError("network_error", "Could not reach DM Faster authentication.", null, { cause });
  } finally {
    clearTimeout(timeout);
  }
}

function parseCredential(value: unknown): AgentCredentialSummary {
  if (!isRecord(value)) {
    throw new AgentAuthError("invalid_response", "DM Faster returned an invalid credential summary.");
  }
  const scopes = value.scopes;
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string")) {
    throw new AgentAuthError("invalid_response", "DM Faster returned invalid credential scopes.");
  }
  return {
    id: requiredString(value, "id", "credential identifier", 200),
    name: requiredString(value, "name", "credential name", 200),
    client: requiredString(value, "client", "credential client", 200),
    scopes: scopes.map(String),
    expiresAt: requiredString(value, "expiresAt", "credential expiration", 100),
  };
}

function parseParty(value: unknown, description: string) {
  if (!isRecord(value)) {
    throw new AgentAuthError("invalid_response", `DM Faster returned an invalid ${description}.`);
  }
  const email = optionalString(value, "email", 320);
  return {
    id: requiredString(value, "id", `${description} identifier`, 200),
    name: requiredString(value, "name", `${description} name`, 300),
    ...(email ? { email } : {}),
  };
}

function parseIdentity(body: unknown): AgentIdentity {
  if (!isRecord(body)) {
    throw new AgentAuthError("invalid_response", "DM Faster returned an invalid authentication response.");
  }
  return {
    credential: parseCredential(body.credential),
    workspace: parseParty(body.workspace, "workspace"),
    user: parseParty(body.user, "user"),
  };
}

export function createPkcePair(randomBytes: (size: number) => Buffer = nodeRandomBytes) {
  const codeVerifier = randomBytes(32).toString("base64url");
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeVerifier)) {
    throw new AgentAuthError("pkce_generation_failed", "Could not create a secure DM Faster sign-in request.");
  }
  const codeChallenge = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function sanitizeDeviceName(value: string) {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return normalized || "This computer";
}

export async function beginDeviceAuthorization(input: {
  baseUrl: string;
  client?: string;
  deviceName?: string;
  access?: DmfasterAgentAccessProfile;
  adapters?: DeviceAuthAdapters;
}): Promise<PendingDeviceAuthorization> {
  const baseUrl = normalizeApiBaseUrl(input.baseUrl);
  const fetchImplementation = input.adapters?.fetch ?? globalThis.fetch;
  const { codeVerifier, codeChallenge } = createPkcePair(input.adapters?.randomBytes);
  const response = await authFetch(
    `${baseUrl}/api/v1/agent/auth/device`,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client: input.client ?? "DM Faster CLI",
        deviceName: sanitizeDeviceName(
          input.deviceName ?? input.adapters?.hostname?.() ?? nodeHostname(),
        ),
        codeChallenge,
        codeChallengeMethod: "S256",
        scopes: getDmfasterAgentScopes(input.access),
        expiresInDays: DMFASTER_CREDENTIAL_EXPIRY_DAYS,
      }),
    },
    fetchImplementation,
  );
  const body = await readJson(response);
  if (!response.ok) throw errorForResponse(response, body);
  if (!isRecord(body)) {
    throw new AgentAuthError("invalid_response", "DM Faster returned an invalid device sign-in response.");
  }
  const confirmationCode = optionalString(body, "confirmationCode", 40)
    ?? requiredString(body, "userCode", "confirmation code", 40);
  const verificationUrlValue = optionalString(body, "verificationUrl")
    ?? requiredString(body, "verificationUri", "browser verification URL");
  const deviceCode = requiredString(body, "deviceCode", "device authorization");
  if (!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(confirmationCode)) {
    throw new AgentAuthError("invalid_response", "DM Faster returned an invalid confirmation code.");
  }
  if (!/^dmf_device_[A-Za-z0-9_-]{43}$/.test(deviceCode)) {
    throw new AgentAuthError("invalid_response", "DM Faster returned an invalid device authorization.");
  }
  return {
    deviceCode,
    codeVerifier,
    confirmationCode,
    verificationUrl: validateVerificationUrl(verificationUrlValue, baseUrl),
    expiresIn: boundedInteger(body.expiresIn, 300, 30, 900),
    interval: boundedInteger(body.interval, 5, 1, 30),
  };
}

export async function pollDeviceAuthorization(input: {
  baseUrl: string;
  authorization: PendingDeviceAuthorization;
  adapters?: DeviceAuthAdapters;
}): Promise<DeviceAuthorizationResult> {
  const baseUrl = normalizeApiBaseUrl(input.baseUrl);
  const fetchImplementation = input.adapters?.fetch ?? globalThis.fetch;
  const now = input.adapters?.now ?? Date.now;
  const sleep = input.adapters?.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const deadline = now() + input.authorization.expiresIn * 1_000;
  let intervalSeconds = input.authorization.interval;

  while (now() < deadline) {
    await sleep(intervalSeconds * 1_000);
    if (now() >= deadline) break;

    let response: Response;
    try {
      response = await authFetch(
        `${baseUrl}/api/v1/agent/auth/token`,
        {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({
            deviceCode: input.authorization.deviceCode,
            codeVerifier: input.authorization.codeVerifier,
          }),
        },
        fetchImplementation,
      );
    } catch (error) {
      if (
        error instanceof AgentAuthError
        && (error.code === "network_error" || error.code === "request_timeout")
      ) continue;
      throw error;
    }

    const body = await readJson(response);
    if (response.ok) {
      if (!isRecord(body)) {
        throw new AgentAuthError("invalid_response", "DM Faster returned an invalid sign-in result.");
      }
      const tokenType = requiredString(body, "tokenType", "token type", 20);
      if (tokenType.toLowerCase() !== "bearer") {
        throw new AgentAuthError("invalid_response", "DM Faster returned an unsupported token type.");
      }
      return {
        accessToken: normalizeAgentAccessToken(requiredString(body, "accessToken", "access token")),
        tokenType: "Bearer",
        ...parseIdentity(body),
      };
    }

    const code = parseErrorCode(body);
    if (response.status === 428 || code === "authorization_pending") {
      if (isRecord(body)) {
        intervalSeconds = boundedInteger(body.interval, intervalSeconds, 1, 30);
      }
      continue;
    }
    if (code === "slow_down") {
      const retryAfter = parseRetryAfterSeconds(response.headers.get("retry-after"), now());
      intervalSeconds = Math.max(intervalSeconds + 5, retryAfter ?? 0);
      continue;
    }
    if (response.status === 429 || code === "rate_limited") {
      throw errorForResponse(response, body, now());
    }
    if (response.status >= 500 && response.status <= 599) continue;
    throw errorForResponse(response, body, now());
  }

  throw new AgentAuthError("expired_token", "DM Faster sign-in timed out. Run `dmfaster auth login` again.");
}

export async function getRemoteAuthStatus(input: {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}) {
  const baseUrl = normalizeApiBaseUrl(input.baseUrl);
  const token = normalizeAgentAccessToken(input.token);
  const response = await authFetch(
    `${baseUrl}/api/v1/agent/auth/status`,
    {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    },
    input.fetch ?? globalThis.fetch,
  );
  const body = await readJson(response);
  if (!response.ok) throw errorForResponse(response, body);
  if (!isRecord(body) || body.authenticated !== true) {
    throw new AgentAuthError("invalid_response", "DM Faster returned an invalid authentication status.");
  }
  return parseIdentity(body);
}

export async function revokeRemoteCredential(input: {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}) {
  const baseUrl = normalizeApiBaseUrl(input.baseUrl);
  const token = normalizeAgentAccessToken(input.token);
  const response = await authFetch(
    `${baseUrl}/api/v1/agent/auth/revoke`,
    {
      method: "POST",
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    },
    input.fetch ?? globalThis.fetch,
  );
  const body = await readJson(response);
  if (!response.ok) throw errorForResponse(response, body);
  if (!isRecord(body) || body.revoked !== true) {
    throw new AgentAuthError("invalid_response", "DM Faster returned an invalid logout response.");
  }
}
