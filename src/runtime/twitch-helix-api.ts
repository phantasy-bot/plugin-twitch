import {
  createPluginModuleLogger,
  fetchWithTimeout,
  LogStorage,
} from "@phantasy/agent/plugin-runtime";

import type { TwitchConfig } from "./twitch-integration-config";
import { getConfigHash } from "./twitch-integration-config";

const logger = createPluginModuleLogger("TwitchHelixApi");

/** Twitch user info returned by the Helix /users endpoint */
export interface TwitchUserInfo {
  id: string;
  login: string;
  display_name: string;
  type: string;
  broadcaster_type: string;
  description: string;
  profile_image_url: string;
  offline_image_url: string;
  view_count: number;
  created_at: string;
  [key: string]: unknown;
}

export interface TwitchUserInfoCache {
  data: TwitchUserInfo;
  timestamp: number;
  configHash: string;
}

const USER_CACHE_TTL = 30 * 60 * 1000;

export async function validateTwitchToken(
  accessToken: string,
  clientId?: string,
): Promise<TwitchUserInfo | null> {
  try {
    const response = await fetchWithTimeout("https://api.twitch.tv/helix/users", {
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": clientId || "",
      },
    });

    if (!response.ok) {
      throw new Error(`Twitch API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { data?: TwitchUserInfo[] };
    return data.data?.[0] || null;
  } catch (error) {
    logger.error("Failed to validate Twitch token:", error);
    return null;
  }
}

export async function getTwitchUserInfo(
  config: TwitchConfig,
  cache: TwitchUserInfoCache | null,
  logStorage: LogStorage,
): Promise<{ userInfo: TwitchUserInfo | null; cache: TwitchUserInfoCache | null }> {
  try {
    const configHash = getConfigHash(config);

    if (
      cache &&
      cache.configHash === configHash &&
      Date.now() - cache.timestamp < USER_CACHE_TTL
    ) {
      return { userInfo: cache.data, cache };
    }

    const userInfo = await validateTwitchToken(config.accessToken, config.clientId);
    if (!userInfo) {
      return { userInfo: null, cache };
    }

    const nextCache: TwitchUserInfoCache = {
      data: userInfo,
      timestamp: Date.now(),
      configHash,
    };

    return { userInfo, cache: nextCache };
  } catch (error: unknown) {
    const errObj = error as { status?: number; message?: string };
    if (errObj?.status === 429) {
      logStorage.addLog("warn", "Twitch API rate limit reached", {
        platform: "twitch",
        error: errObj.message || "Rate limit exceeded",
      });
    } else {
      logStorage.addLog("error", "Failed to get Twitch user info", {
        error: error instanceof Error ? error.message : String(error),
        platform: "twitch",
        status: errObj?.status,
      });
    }

    if (errObj?.status !== 429 && cache) {
      logStorage.addLog("info", "Using stale cached user info due to error", {
        platform: "twitch",
      });
      return { userInfo: cache.data, cache };
    }

    if (errObj?.status === 429) {
      const rateLimitError: Error & { status?: number } = new Error(
        "Rate limit exceeded. Please wait before trying again.",
      );
      rateLimitError.status = 429;
      throw rateLimitError;
    }

    return { userInfo: null, cache };
  }
}

export async function getTwitchBroadcasterId(
  channelName: string,
  config: TwitchConfig,
): Promise<string> {
  const response = await fetchWithTimeout(
    `https://api.twitch.tv/helix/users?login=${channelName}`,
    {
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Client-Id": config.clientId,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to get broadcaster ID: ${response.status}`);
  }

  const data = (await response.json()) as { data?: Array<{ id: string }> };
  return data.data?.[0]?.id || "";
}

export async function sendTwitchHelixChatMessage(
  channelName: string,
  message: string,
  config: TwitchConfig,
  userInfo: TwitchUserInfo | null,
): Promise<void> {
  let trimmedMessage = message;
  if (trimmedMessage.length > 500) {
    trimmedMessage = trimmedMessage.substring(0, 497) + "...";
  }

  const broadcasterId = await getTwitchBroadcasterId(channelName, config);
  const senderId = userInfo?.id || "";

  const response = await fetchWithTimeout("https://api.twitch.tv/helix/chat/messages", {
    timeout: 10000,
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Client-Id": config.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      broadcaster_id: broadcasterId,
      sender_id: senderId,
      message: trimmedMessage,
    }),
  });

  if (!response.ok) {
    throw new Error(`Twitch API error: ${response.status} ${response.statusText}`);
  }
}
