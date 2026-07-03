import {
  AGENT_DEFAULTS,
  createPluginModuleLogger,
  kvService,
  LogStorage,
  type ServerEnv,
} from "@phantasy/agent/plugin-runtime";

import {
  getStoredAgentTwitchConfig,
  normalizeTwitchConfig,
  buildAgentTwitchSyncPayload,
  type TwitchConfig,
} from "./runtime/twitch-integration-config";
import {
  getTwitchUserInfo,
  sendTwitchHelixChatMessage,
  validateTwitchToken,
  type TwitchUserInfo,
  type TwitchUserInfoCache,
} from "./runtime/twitch-helix-api";

const logger = createPluginModuleLogger("TwitchIntegration");

export type { TwitchConfig } from "./runtime/twitch-integration-config";
export type { TwitchUserInfo } from "./runtime/twitch-helix-api";

export interface TwitchChatMessage {
  id: string;
  username: string;
  displayName: string;
  color?: string;
  badges: { [key: string]: string };
  message: string;
  timestamp: Date;
  userState: Record<string, unknown>;
  channel: string;
  emotes?: { [key: string]: string[] };
  isMod: boolean;
  isSubscriber: boolean;
  isVip: boolean;
  isBroadcaster: boolean;
}

function getTwitchIntegrationConfig(agent: unknown): Partial<TwitchConfig> | undefined {
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    return undefined;
  }

  const integrations = (agent as Record<string, unknown>).integrations;
  if (!integrations || typeof integrations !== "object" || Array.isArray(integrations)) {
    return undefined;
  }

  const twitch = (integrations as Record<string, unknown>).twitch;
  if (!twitch || typeof twitch !== "object" || Array.isArray(twitch)) {
    return undefined;
  }

  const record = twitch as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    return undefined;
  }

  return {
    clientId: typeof record.clientId === "string" ? record.clientId.trim() : undefined,
    clientSecret:
      typeof record.clientSecret === "string" ? record.clientSecret.trim() : undefined,
    accessToken:
      typeof record.accessToken === "string" ? record.accessToken.trim() : undefined,
    refreshToken:
      typeof record.refreshToken === "string" ? record.refreshToken.trim() : undefined,
    channelName:
      typeof record.channelName === "string" ? record.channelName.trim() : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    username: typeof record.username === "string" ? record.username.trim() : undefined,
  };
}

export class TwitchIntegration {
  private logStorage: LogStorage;
  private userInfoCache: TwitchUserInfoCache | null = null;

  constructor(_env: ServerEnv) {
    this.logStorage = LogStorage.getInstance();
  }

  static async test(
    agent: unknown,
  ): Promise<{ success: boolean; error?: string; userInfo?: TwitchUserInfo }> {
    try {
      const integrationConfig = getTwitchIntegrationConfig(agent);
      const config = {
        clientId: integrationConfig?.clientId,
        clientSecret: integrationConfig?.clientSecret,
        accessToken: integrationConfig?.accessToken,
        refreshToken: integrationConfig?.refreshToken,
        channelName: integrationConfig?.channelName,
        enabled: integrationConfig?.enabled,
      };

      if (
        !config.clientId ||
        !config.clientSecret ||
        !config.accessToken ||
        !config.channelName
      ) {
        return {
          success: false,
          error: "Missing Twitch API credentials. Please check your configuration.",
        };
      }

      const userInfo = await validateTwitchToken(config.accessToken, config.clientId);
      if (userInfo) {
        return { success: true, userInfo };
      }

      return { success: false, error: "Failed to authenticate with Twitch" };
    } catch (error: unknown) {
      logger.error("Twitch test connection failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Twitch API connection failed",
      };
    }
  }

  async getConfig(): Promise<TwitchConfig | null> {
    try {
      const config = await kvService.get("integration:twitch");
      if (config && typeof config === "object" && !Array.isArray(config)) {
        if (Object.keys(config).length > 0) {
          return normalizeTwitchConfig(config as Partial<TwitchConfig>);
        }
      }

      const agent = await kvService.get(AGENT_DEFAULTS.ID);
      return getStoredAgentTwitchConfig(agent);
    } catch (error) {
      this.logStorage.addLog("error", "Failed to get Twitch config", {
        error,
        platform: "twitch",
      });
      return null;
    }
  }

  async saveConfig(config: TwitchConfig): Promise<boolean> {
    try {
      const normalizedConfig = normalizeTwitchConfig(config);

      if (
        !normalizedConfig.clientId ||
        !normalizedConfig.clientSecret ||
        !normalizedConfig.accessToken ||
        !normalizedConfig.channelName
      ) {
        throw new Error("All Twitch credentials are required");
      }

      await kvService.set("integration:twitch", normalizedConfig);

      const agent = (await kvService.get(AGENT_DEFAULTS.ID)) as Record<
        string,
        unknown
      > | null;
      if (agent) {
        await kvService.set(
          AGENT_DEFAULTS.ID,
          buildAgentTwitchSyncPayload(agent, normalizedConfig),
        );
      }

      this.logStorage.addLog("info", "Twitch config saved successfully", {
        platform: "twitch",
      });
      return true;
    } catch (error) {
      this.logStorage.addLog("error", "Failed to save Twitch config", {
        error,
        platform: "twitch",
      });
      return false;
    }
  }

  async checkConnectionStatus(): Promise<boolean> {
    try {
      const config = await this.getConfig();
      if (!config) return false;
      return !!config.username;
    } catch {
      return false;
    }
  }

  async testConnection(
    providedConfig?: Partial<TwitchConfig>,
  ): Promise<{ success: boolean; error?: string; userInfo?: TwitchUserInfo }> {
    try {
      let config: TwitchConfig | null = null;
      let isTemporaryConfig = false;

      if (
        providedConfig &&
        providedConfig.clientId &&
        providedConfig.clientSecret &&
        providedConfig.accessToken &&
        providedConfig.channelName
      ) {
        config = {
          clientId: providedConfig.clientId,
          clientSecret: providedConfig.clientSecret,
          accessToken: providedConfig.accessToken,
          refreshToken: providedConfig.refreshToken || "",
          channelName: providedConfig.channelName,
          enabled: providedConfig.enabled || false,
        };
        isTemporaryConfig = true;
      } else {
        config = await this.getConfig();
        if (!config) {
          return { success: false, error: "No configuration found" };
        }
      }

      const userInfo = await this.getUserInfo(config);
      if (userInfo) {
        if (!isTemporaryConfig) {
          config.username = userInfo.login;
          await this.saveConfig(config);
        }

        this.logStorage.addLog("info", "Twitch connection test successful", {
          platform: "twitch",
          username: userInfo.login,
        });

        return { success: true, userInfo };
      }

      return { success: false, error: "Failed to authenticate" };
    } catch (error: unknown) {
      if ((error as { status?: number })?.status === 429) {
        throw error;
      }
      this.logStorage.addLog("error", "Twitch connection test failed", {
        error,
        platform: "twitch",
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  private async getUserInfo(config: TwitchConfig): Promise<TwitchUserInfo | null> {
    const result = await getTwitchUserInfo(config, this.userInfoCache, this.logStorage);
    this.userInfoCache = result.cache;
    return result.userInfo;
  }

  async sendChatMessage(channelName: string, message: string): Promise<boolean> {
    try {
      const config = await this.getConfig();
      if (!config || !config.enabled) {
        this.logStorage.addLog("error", "Twitch not configured or disabled", {
          platform: "twitch",
        });
        return false;
      }

      const userInfo = await this.getUserInfo(config);
      await sendTwitchHelixChatMessage(channelName, message, config, userInfo);

      this.logStorage.addLog("info", "Twitch chat message sent successfully", {
        channelName,
        message,
        platform: "twitch",
      });

      return true;
    } catch (error) {
      this.logStorage.addLog("error", "Failed to send Twitch chat message", {
        error,
        platform: "twitch",
      });
      return false;
    }
  }

  processChatMessage(message: TwitchChatMessage): void {
    try {
      this.logStorage.addLog("info", "Received Twitch chat message", {
        platform: "twitch",
        username: message.username,
        messageLength: message.message.length,
        channel: message.channel,
        isMod: message.isMod,
        isSubscriber: message.isSubscriber,
        timestamp: message.timestamp,
      });

      logger.info("Twitch chat message:", {
        username: message.username,
        message: message.message,
        channel: message.channel,
      });
    } catch (error) {
      this.logStorage.addLog("error", "Failed to process Twitch chat message", {
        error,
        platform: "twitch",
      });
    }
  }
}
