import { TwitchAdvancedConfig, defaultTwitchAdvancedConfig } from "../twitch-config";

type IntegrationPluginPermissions = Record<string, unknown>;

export interface TwitchConfig {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  channelName: string;
  enabled: boolean;
  autoStart?: boolean;
  connected?: boolean;
  username?: string;
  advanced?: TwitchAdvancedConfig;
  pluginPermissions?: IntegrationPluginPermissions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getNestedRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const next = value[key];
  return isRecord(next) ? next : {};
}

function getTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getTwitchIntegrationConfig(agent: unknown): Partial<TwitchConfig> | undefined {
  const integrations = getNestedRecord(agent, "integrations");
  const twitch = getNestedRecord(integrations, "twitch");
  if (Object.keys(twitch).length === 0) {
    return undefined;
  }

  return {
    clientId: getTrimmedString(twitch.clientId),
    clientSecret: getTrimmedString(twitch.clientSecret),
    accessToken: getTrimmedString(twitch.accessToken),
    refreshToken: getTrimmedString(twitch.refreshToken),
    channelName: getTrimmedString(twitch.channelName),
    enabled: typeof twitch.enabled === "boolean" ? twitch.enabled : undefined,
    autoStart: typeof twitch.autoStart === "boolean" ? twitch.autoStart : undefined,
    username: getTrimmedString(twitch.username),
  };
}

function getLegacyTwitchMetadata(agent: unknown): Partial<TwitchConfig> | undefined {
  const metadata = getNestedRecord(agent, "metadata");
  const twitch = getNestedRecord(metadata, "twitch");
  if (Object.keys(twitch).length === 0) {
    return undefined;
  }

  return {
    channelName: getTrimmedString(twitch.channelName),
    enabled: typeof twitch.enabled === "boolean" ? twitch.enabled : undefined,
    username: getTrimmedString(twitch.username),
    advanced: isRecord(twitch.advanced)
      ? (twitch.advanced as unknown as TwitchAdvancedConfig)
      : undefined,
  };
}

export function normalizeTwitchConfig(config: Partial<TwitchConfig>): TwitchConfig {
  return {
    clientId: getTrimmedString(config.clientId) || "",
    clientSecret: getTrimmedString(config.clientSecret) || "",
    accessToken: getTrimmedString(config.accessToken) || "",
    refreshToken: getTrimmedString(config.refreshToken) || "",
    channelName: getTrimmedString(config.channelName) || "",
    enabled: typeof config.enabled === "boolean" ? config.enabled : true,
    autoStart: typeof config.autoStart === "boolean" ? config.autoStart : undefined,
    connected: typeof config.connected === "boolean" ? config.connected : undefined,
    username: getTrimmedString(config.username),
    advanced: isRecord(config.advanced)
      ? (config.advanced as unknown as TwitchAdvancedConfig)
      : defaultTwitchAdvancedConfig,
    pluginPermissions: isRecord(config.pluginPermissions)
      ? (config.pluginPermissions as IntegrationPluginPermissions)
      : undefined,
  };
}

export function getStoredAgentTwitchConfig(agent: unknown): TwitchConfig | null {
  const integrationConfig = getTwitchIntegrationConfig(agent);
  const legacyMetadata = getLegacyTwitchMetadata(agent);
  if (!integrationConfig && !legacyMetadata) {
    return null;
  }

  return normalizeTwitchConfig({
    ...legacyMetadata,
    ...integrationConfig,
  });
}

export function getConfigHash(config: TwitchConfig): string {
  return `${config.clientId}_${config.clientSecret}_${config.accessToken}_${config.channelName}`;
}

export function buildAgentTwitchSyncPayload(
  agent: Record<string, unknown>,
  normalizedConfig: TwitchConfig,
): Record<string, unknown> {
  const integrations = getNestedRecord(agent, "integrations");
  return {
    ...agent,
    metadata: {
      ...((agent.metadata as Record<string, unknown>) || {}),
      twitch: {
        enabled: normalizedConfig.enabled,
        username: normalizedConfig.username,
        channelName: normalizedConfig.channelName,
        advanced: normalizedConfig.advanced,
      },
    },
    integrations: {
      ...integrations,
      twitch: {
        enabled: normalizedConfig.enabled,
        autoStart: normalizedConfig.autoStart,
        clientId: normalizedConfig.clientId,
        clientSecret: normalizedConfig.clientSecret,
        accessToken: normalizedConfig.accessToken,
        refreshToken: normalizedConfig.refreshToken,
        channelName: normalizedConfig.channelName,
        username: normalizedConfig.username,
        advanced: normalizedConfig.advanced,
        pluginPermissions: normalizedConfig.pluginPermissions,
      },
    },
  };
}
