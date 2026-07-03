import { defaultTwitchAdvancedConfig, type TwitchAdvancedConfig } from "../twitch-config";
import type { TwitchConfig } from "../twitch-integration";
import {
  readBoolean,
  readConfigObject,
  readOptionalString,
  readRequiredString,
} from "./config-helpers";

export function buildTwitchUrl(channelName?: string): string | undefined {
  return channelName ? `https://twitch.tv/${channelName}` : undefined;
}

export function buildTwitchRuntimeConfig(input: {
  overrides?: Partial<TwitchConfig>;
  snapshot: Partial<TwitchConfig>;
  stored: TwitchConfig | null;
}): TwitchConfig | null {
  const { overrides, snapshot, stored } = input;
  const runtimeConfig: TwitchConfig = {
    clientId: readRequiredString(
      overrides?.clientId,
      snapshot.clientId,
      stored?.clientId,
      process.env.TWITCH_CLIENT_ID,
    ),
    clientSecret: readRequiredString(
      overrides?.clientSecret,
      snapshot.clientSecret,
      stored?.clientSecret,
      process.env.TWITCH_CLIENT_SECRET,
    ),
    accessToken: readRequiredString(
      overrides?.accessToken,
      snapshot.accessToken,
      stored?.accessToken,
      process.env.TWITCH_ACCESS_TOKEN,
    ),
    refreshToken: readRequiredString(
      overrides?.refreshToken,
      snapshot.refreshToken,
      stored?.refreshToken,
      process.env.TWITCH_REFRESH_TOKEN,
    ),
    channelName: readRequiredString(
      overrides?.channelName,
      snapshot.channelName,
      stored?.channelName,
      process.env.TWITCH_CHANNEL_NAME,
    ),
    enabled:
      typeof overrides?.enabled === "boolean"
        ? overrides.enabled
        : typeof snapshot.enabled === "boolean"
          ? snapshot.enabled
          : typeof stored?.enabled === "boolean"
            ? stored.enabled
            : true,
    autoStart: readBoolean(overrides?.autoStart, snapshot.autoStart, stored?.autoStart),
    connected: stored?.connected,
    username: readOptionalString(
      overrides?.username,
      snapshot.username,
      stored?.username,
      process.env.TWITCH_USERNAME,
    ),
    advanced:
      readConfigObject<TwitchAdvancedConfig>(
        overrides?.advanced,
        snapshot.advanced,
        stored?.advanced,
      ) || defaultTwitchAdvancedConfig,
    pluginPermissions: readConfigObject(
      overrides?.pluginPermissions,
      snapshot.pluginPermissions,
      stored?.pluginPermissions,
    ),
  };

  if (
    !runtimeConfig.clientId ||
    !runtimeConfig.clientSecret ||
    !runtimeConfig.accessToken ||
    !runtimeConfig.channelName
  ) {
    return null;
  }

  return runtimeConfig;
}
