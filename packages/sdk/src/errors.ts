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

  constructor(input: {
    message: string;
    status: number;
    responseBody: unknown;
  }) {
    super(input.message, "http_error");
    this.name = "DmfasterHttpError";
    this.status = input.status;
    this.responseBody = input.responseBody;
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
