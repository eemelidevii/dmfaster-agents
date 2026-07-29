import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { DEFAULT_DMFASTER_API_URL } from "./constants.ts";
import {
  CredentialStoreUnavailableError,
  createSystemCredentialStore,
  credentialSourceLabel,
  normalizeAgentAccessToken,
  type CredentialStore,
} from "./credential-store.ts";
import { normalizeApiBaseUrl } from "./url.ts";

type FileConfig = {
  baseUrl?: string;
};

export type LocalCredentialSource =
  | "DMFASTER_TOKEN"
  | "macOS Keychain"
  | "Linux Secret Service"
  | "secure credential store"
  | null;

export type ResolvedLocalAuthConfig = {
  baseUrl: string;
  baseUrlSource: "DMFASTER_API_URL" | "config file" | "default";
  token: string | null;
  tokenSource: LocalCredentialSource;
  credentialStoreError: string | null;
  configPath: string;
};

function nonEmpty(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

export function defaultConfigPath(env: NodeJS.ProcessEnv, homeDirectory: string) {
  const override = nonEmpty(env.DMFASTER_CONFIG);
  if (override) return override;
  const configRoot = nonEmpty(env.XDG_CONFIG_HOME) || join(homeDirectory, ".config");
  return join(configRoot, "dmfaster", "config.json");
}

async function readConfigFile(path: string): Promise<FileConfig> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (cause) {
    throw new Error(`DM Faster config at ${path} is not valid JSON.`, { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`DM Faster config at ${path} must contain a JSON object.`);
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.baseUrl !== undefined && typeof candidate.baseUrl !== "string") {
    throw new Error(`DM Faster config baseUrl at ${path} must be a string.`);
  }
  if (candidate.token !== undefined) {
    throw new Error(
      `DM Faster config at ${path} contains an unsupported plaintext token. Remove it and use secure login or DMFASTER_TOKEN.`,
    );
  }
  return {
    ...(typeof candidate.baseUrl === "string" ? { baseUrl: candidate.baseUrl } : {}),
  };
}

export async function resolveLocalAuthConfig(input: {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  credentialStore?: CredentialStore;
} = {}): Promise<ResolvedLocalAuthConfig> {
  const env = input.env ?? process.env;
  const path = defaultConfigPath(env, input.homeDirectory ?? homedir());
  const file = await readConfigFile(path);
  const environmentBaseUrl = nonEmpty(env.DMFASTER_API_URL);
  const fileBaseUrl = nonEmpty(file.baseUrl);
  const baseUrl = normalizeApiBaseUrl(
    environmentBaseUrl || fileBaseUrl || DEFAULT_DMFASTER_API_URL,
  );
  const environmentToken = nonEmpty(env.DMFASTER_TOKEN);

  if (environmentToken) {
    return {
      baseUrl,
      baseUrlSource: environmentBaseUrl
        ? "DMFASTER_API_URL"
        : fileBaseUrl ? "config file" : "default",
      token: normalizeAgentAccessToken(environmentToken),
      tokenSource: "DMFASTER_TOKEN",
      credentialStoreError: null,
      configPath: path,
    };
  }

  const store = input.credentialStore ?? createSystemCredentialStore();
  try {
    const token = await store.get(baseUrl);
    return {
      baseUrl,
      baseUrlSource: environmentBaseUrl
        ? "DMFASTER_API_URL"
        : fileBaseUrl ? "config file" : "default",
      token,
      tokenSource: token ? credentialSourceLabel(store.kind) : null,
      credentialStoreError: null,
      configPath: path,
    };
  } catch (error) {
    if (!(error instanceof CredentialStoreUnavailableError)) throw error;
    return {
      baseUrl,
      baseUrlSource: environmentBaseUrl
        ? "DMFASTER_API_URL"
        : fileBaseUrl ? "config file" : "default",
      token: null,
      tokenSource: null,
      credentialStoreError: error.message,
      configPath: path,
    };
  }
}
