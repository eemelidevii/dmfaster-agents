export const DEFAULT_DMFASTER_API_URL = "https://app.dmfaster.com";

export const DMFASTER_AGENT_SCOPES = [
  "workspace:read",
  "campaigns:read",
  "sending:read",
  "inbox:read",
  "pipeline:read",
  "audiences:read",
  "campaigns:write",
  "campaigns:launch",
] as const;

export const DMFASTER_AGENT_ACCESS_PROFILES = Object.freeze({
  read: Object.freeze(DMFASTER_AGENT_SCOPES.slice(0, 5)),
  plan: Object.freeze(DMFASTER_AGENT_SCOPES.slice(0, 6)),
  draft: Object.freeze(DMFASTER_AGENT_SCOPES.slice(0, 7)),
  full: Object.freeze([...DMFASTER_AGENT_SCOPES]),
});

export type DmfasterAgentAccessProfile = keyof typeof DMFASTER_AGENT_ACCESS_PROFILES;

export function isDmfasterAgentAccessProfile(
  value: unknown,
): value is DmfasterAgentAccessProfile {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(DMFASTER_AGENT_ACCESS_PROFILES, value);
}

export function getDmfasterAgentScopes(
  profile: DmfasterAgentAccessProfile = "full",
) {
  if (!isDmfasterAgentAccessProfile(profile)) {
    throw new TypeError("Unknown DM Faster agent access profile.");
  }
  return [...DMFASTER_AGENT_ACCESS_PROFILES[profile]];
}

export const DMFASTER_CREDENTIAL_EXPIRY_DAYS = 30;
