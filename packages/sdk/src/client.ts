import {
  AGENT_TOOL_POLICIES,
  type AgentToolDataMap,
  type AgentToolInputMap,
  type AgentToolName,
  type AgentToolResult,
} from "./contracts.ts";
import {
  DmfasterHttpError,
  DmfasterProtocolError,
  DmfasterSdkError,
  DmfasterTimeoutError,
} from "./errors.ts";

const DEFAULT_TIMEOUT_MS = 45_000;

export type DmfasterClientOptions = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export type AgentToolCallOptions = {
  signal?: AbortSignal;
};

function normalizeBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new DmfasterSdkError("DM Faster base URL must be an absolute URL.", "invalid_base_url", { cause });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DmfasterSdkError("DM Faster base URL must use HTTP or HTTPS.", "invalid_base_url");
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (url.protocol === "http:" && !loopbackHosts.has(url.hostname.toLowerCase())) {
    throw new DmfasterSdkError(
      "DM Faster base URL must use HTTPS unless it is a loopback development endpoint.",
      "invalid_base_url",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new DmfasterSdkError(
      "DM Faster base URL cannot include credentials, a query string, or a fragment.",
      "invalid_base_url",
    );
  }
  if (url.pathname !== "/") {
    throw new DmfasterSdkError(
      "DM Faster base URL must be an origin without a pathname.",
      "invalid_base_url",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

function normalizeTimeout(value: number | undefined) {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new DmfasterSdkError(
      "DM Faster request timeout must be an integer from 1 to 120000 ms.",
      "invalid_timeout",
    );
  }
  return timeoutMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessageFromBody(body: unknown, status: number) {
  if (isRecord(body)) {
    if (typeof body.message === "string" && body.message.trim()) return body.message;
    if (isRecord(body.error) && typeof body.error.message === "string" && body.error.message.trim()) {
      return body.error.message;
    }
  }
  return `DM Faster API request failed with HTTP ${status}.`;
}

function boundedTransportString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() && value.length <= maxLength
    ? value.trim()
    : null;
}

function transportErrorFromBody(body: unknown) {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  return {
    code: boundedTransportString(error?.code, 100),
    retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
    requestId: boundedTransportString(error?.requestId, 128),
    details: isRecord(error?.details) ? error.details : null,
  };
}

function parseRetryAfterSeconds(value: string | null) {
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
    ? Math.min(24 * 60 * 60, Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000)))
    : null;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new DmfasterProtocolError("DM Faster API returned invalid JSON.", { cause });
  }
}

function assertToolResult<Name extends AgentToolName>(
  value: unknown,
  expectedTool: Name,
): asserts value is AgentToolResult<AgentToolDataMap[Name]> {
  if (!isRecord(value) || value.version !== 1 || value.tool !== expectedTool || typeof value.ok !== "boolean") {
    throw new DmfasterProtocolError(
      `DM Faster API returned an invalid result envelope for ${expectedTool}.`,
    );
  }
  if (!Array.isArray(value.evidence) || !Array.isArray(value.artifacts) || !isRecord(value.consistency)) {
    throw new DmfasterProtocolError(
      `DM Faster API returned an incomplete result envelope for ${expectedTool}.`,
    );
  }
  const expectedPolicy = AGENT_TOOL_POLICIES[expectedTool];
  if (
    !isRecord(value.policy)
    || Object.keys(value.policy).length !== 3
    || value.policy.effect !== expectedPolicy.effect
    || value.policy.approval !== expectedPolicy.approval
    || value.policy.exposure !== expectedPolicy.exposure
  ) {
    throw new DmfasterProtocolError(
      `DM Faster API returned an unsafe result policy for ${expectedTool}.`,
    );
  }
  if (
    typeof value.generatedAt !== "string"
    || !Number.isFinite(Date.parse(value.generatedAt))
    || typeof value.durationMs !== "number"
    || !Number.isFinite(value.durationMs)
    || value.durationMs < 0
    || value.durationMs > 120_000
  ) {
    throw new DmfasterProtocolError(
      `DM Faster API returned invalid result metadata for ${expectedTool}.`,
    );
  }
  if (
    (value.ok && value.error !== null)
    || (!value.ok && (!isRecord(value.error) || value.data !== null))
  ) {
    throw new DmfasterProtocolError(
      `DM Faster API returned an invalid error envelope for ${expectedTool}.`,
    );
  }
}

export class DmfasterClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  readonly #token: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: DmfasterClientOptions) {
    const token = options.token.trim();
    if (!token) {
      throw new DmfasterSdkError("A DM Faster bearer token is required.", "missing_token");
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.#token = token;
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") {
      throw new DmfasterSdkError("No Fetch API implementation is available.", "missing_fetch");
    }
  }

  async invoke<Name extends AgentToolName>(
    tool: Name,
    input: AgentToolInputMap[Name],
    options: AgentToolCallOptions = {},
  ): Promise<AgentToolResult<AgentToolDataMap[Name]>> {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.#fetch(
        `${this.baseUrl}/api/v1/agent/tools/${encodeURIComponent(tool)}`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${this.#token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
          redirect: "error",
          signal: controller.signal,
        },
      );
      const body = await readJson(response);
      if (!response.ok) {
        const transportError = transportErrorFromBody(body);
        throw new DmfasterHttpError({
          message: errorMessageFromBody(body, response.status),
          status: response.status,
          responseBody: body,
          ...(transportError.code ? { code: transportError.code } : {}),
          retryable: transportError.retryable,
          requestId: transportError.requestId
            ?? boundedTransportString(response.headers.get("x-request-id"), 128),
          retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after")),
          details: transportError.details,
        });
      }
      assertToolResult(body, tool);
      return body;
    } catch (cause) {
      if (timedOut) throw new DmfasterTimeoutError(this.timeoutMs, { cause });
      if (cause instanceof DmfasterSdkError) throw cause;
      if (controller.signal.aborted) {
        throw new DmfasterSdkError("DM Faster request was aborted.", "request_aborted", { cause });
      }
      throw new DmfasterSdkError("DM Faster request failed before a response was received.", "network_error", {
        cause,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
}

export function createDmfasterClient(options: DmfasterClientOptions) {
  return new DmfasterClient(options);
}
