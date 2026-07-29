export const DEFAULT_DMFASTER_API_URL = "https://app.dmfaster.com";

export const DMFASTER_AGENT_SCOPES = [
  "workspace:read",
  "campaigns:read",
  "sending:read",
  "inbox:read",
  "pipeline:read",
] as const;

export const DMFASTER_CREDENTIAL_EXPIRY_DAYS = 30;
