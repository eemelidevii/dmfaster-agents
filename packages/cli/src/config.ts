import {
  DEFAULT_DMFASTER_API_URL,
  resolveLocalAuthConfig,
  type CredentialStore,
  type ResolvedLocalAuthConfig,
} from "@dmfaster/local-auth";

export const DEFAULT_API_URL = DEFAULT_DMFASTER_API_URL;
export type ResolvedCliConfig = ResolvedLocalAuthConfig;

export function resolveCliConfig(input: {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  credentialStore?: CredentialStore;
} = {}) {
  return resolveLocalAuthConfig(input);
}
