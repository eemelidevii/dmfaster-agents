export class DmfasterSdkError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DmfasterSdkError";
    this.code = code;
  }
}

export class DmfasterHttpError extends DmfasterSdkError {
  readonly status: number;
  readonly responseBody: unknown;
  readonly retryable: boolean | null;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;
  readonly details: Record<string, unknown> | null;

  constructor(input: {
    message: string;
    status: number;
    responseBody: unknown;
    code?: string;
    retryable?: boolean | null;
    requestId?: string | null;
    retryAfterSeconds?: number | null;
    details?: Record<string, unknown> | null;
  }) {
    super(input.message, input.code || "http_error");
    this.name = "DmfasterHttpError";
    this.status = input.status;
    this.responseBody = input.responseBody;
    this.retryable = input.retryable ?? null;
    this.requestId = input.requestId ?? null;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
    this.details = input.details ?? null;
  }
}

export class DmfasterTimeoutError extends DmfasterSdkError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, options?: ErrorOptions) {
    super(`DM Faster request timed out after ${timeoutMs} ms.`, "request_timeout", options);
    this.name = "DmfasterTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class DmfasterProtocolError extends DmfasterSdkError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "invalid_response", options);
    this.name = "DmfasterProtocolError";
  }
}
