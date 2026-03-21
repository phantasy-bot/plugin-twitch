import {
  AGENT_DEFAULTS,
  createPluginModuleLogger,
  fetchWithTimeout,
  kvService,
  LogStorage,
} from "@phantasy/agent/plugin-runtime";
import {
  TwitchAdvancedConfig,
  defaultTwitchAdvancedConfig,
} from "./twitch-config";

type IntegrationPluginPermissions = Record<string, unknown>;
type Env = Record<string, unknown>;

const logger = createPluginModuleLogger("TwitchIntegration");

export interface TwitchConfig {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  channelName: string;
  enabled: boolean;
  connected?: boolean;
  username?: string;
  advanced?: TwitchAdvancedConfig;
  pluginPermissions?: IntegrationPluginPermissions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizeTwitchConfig(
  config: Partial<TwitchConfig>,
): TwitchConfig {
  return {
    clientId: getTrimmedString(config.clientId) || "",
    clientSecret: getTrimmedString(config.clientSecret) || "",
    accessToken: getTrimmedString(config.accessToken) || "",
    refreshToken: getTrimmedString(config.refreshToken) || "",
    channelName: getTrimmedString(config.channelName) || "",
    enabled: typeof config.enabled === "boolean" ? config.enabled : true,
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

function getStoredAgentTwitchConfig(agent: unknown): TwitchConfig | null {
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

function getNestedRecord(
  value: unknown,
  key: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const next = record[key];
  if (!next || typeof next !== "object" || Array.isArray(next)) {
    return {};
  }

  return next as Record<string, unknown>;
}

function getTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

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

/** Twitch user info returned by the Helix /users endpoint */
interface TwitchUserInfo {
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

export class TwitchIntegration {
  private env: Env;
  private logStorage: LogStorage;
  private userInfoCache: {
    data: TwitchUserInfo;
    timestamp: number;
    configHash: string;
  } | null = null;
  private readonly USER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache

  constructor(env: Env) {
    this.env = env;
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

      // Check if all required fields are present
      if (
        !config.clientId ||
        !config.clientSecret ||
        !config.accessToken ||
        !config.channelName
      ) {
        return {
          success: false,
          error:
            "Missing Twitch API credentials. Please check your configuration.",
        };
      }

      // Test the connection using Twitch API
      const userInfo = await TwitchIntegration.validateToken(
        config.accessToken,
        config.clientId,
      );
      if (userInfo) {
        return {
          success: true,
          userInfo,
        };
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

  private static async validateToken(
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
        throw new Error(
          `Twitch API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json() as { data?: TwitchUserInfo[] };
      return data.data?.[0] || null;
    } catch (error) {
      logger.error("Failed to validate Twitch token:", error);
      return null;
    }
  }

  async getConfig(skipConnectionCheck = true): Promise<TwitchConfig | null> {
    try {
      const config = await kvService.get("integration:twitch");
      if (isRecord(config) && Object.keys(config).length > 0) {
        return normalizeTwitchConfig(config as Partial<TwitchConfig>);
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

      // Validate config
      if (
        !normalizedConfig.clientId ||
        !normalizedConfig.clientSecret ||
        !normalizedConfig.accessToken ||
        !normalizedConfig.channelName
      ) {
        throw new Error("All Twitch credentials are required");
      }

      // Set default advanced config if not provided
      // Save to KV
      await kvService.set("integration:twitch", normalizedConfig);

      // Keep the canonical agent config in sync so reloads can recover the integration.
      const agent = await kvService.get(AGENT_DEFAULTS.ID) as Record<string, unknown> | null;
      if (agent) {
        const integrations = getNestedRecord(agent, "integrations");
        agent.metadata = {
          ...(agent.metadata as Record<string, unknown> || {}),
          twitch: {
            enabled: normalizedConfig.enabled,
            username: normalizedConfig.username,
            channelName: normalizedConfig.channelName,
            advanced: normalizedConfig.advanced,
          },
        };
        agent.integrations = {
          ...integrations,
          twitch: {
            enabled: normalizedConfig.enabled,
            clientId: normalizedConfig.clientId,
            clientSecret: normalizedConfig.clientSecret,
            accessToken: normalizedConfig.accessToken,
            refreshToken: normalizedConfig.refreshToken,
            channelName: normalizedConfig.channelName,
            username: normalizedConfig.username,
            advanced: normalizedConfig.advanced,
            pluginPermissions: normalizedConfig.pluginPermissions,
          },
        };
        await kvService.set(AGENT_DEFAULTS.ID, agent);
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
      // Only return true if we have cached username, don't make API calls
      return !!config.username;
    } catch (error) {
      return false;
    }
  }

  async testConnection(
    providedConfig?: Partial<TwitchConfig>,
  ): Promise<{ success: boolean; error?: string; userInfo?: TwitchUserInfo }> {
    try {
      // Use provided config or get from storage
      let config: TwitchConfig | null = null;
      let isTemporaryConfig = false;

      if (
        providedConfig &&
        providedConfig.clientId &&
        providedConfig.clientSecret &&
        providedConfig.accessToken &&
        providedConfig.channelName
      ) {
        // Create a temporary config for testing
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
        // Fall back to saved config
        config = await this.getConfig();
        if (!config) {
          return { success: false, error: "No configuration found" };
        }
      }

      // Test connection by getting user info
      const userInfo = await this.getUserInfo(config);
      if (userInfo) {
        // Only update saved config if not a temporary test
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
      // Re-throw rate limit errors properly
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

  private getConfigHash(config: TwitchConfig): string {
    return `${config.clientId}_${config.clientSecret}_${config.accessToken}_${config.channelName}`;
  }

  private async getUserInfo(config: TwitchConfig): Promise<TwitchUserInfo | null> {
    try {
      const configHash = this.getConfigHash(config);

      // Check cache first
      if (
        this.userInfoCache &&
        this.userInfoCache.configHash === configHash &&
        Date.now() - this.userInfoCache.timestamp < this.USER_CACHE_TTL
      ) {
        return this.userInfoCache.data;
      }

      // Cache miss or expired, make API call
      const userInfo = await TwitchIntegration.validateToken(
        config.accessToken,
        config.clientId,
      );

      if (userInfo) {
        // Update cache
        this.userInfoCache = {
          data: userInfo,
          timestamp: Date.now(),
          configHash,
        };
      }

      return userInfo;
    } catch (error: unknown) {
      const errObj = error as { status?: number; message?: string };
      // Check for rate limit error
      if (errObj?.status === 429) {
        this.logStorage.addLog("warn", "Twitch API rate limit reached", {
          platform: "twitch",
          error: errObj.message || "Rate limit exceeded",
        });
      } else {
        this.logStorage.addLog("error", "Failed to get Twitch user info", {
          error: error instanceof Error ? error.message : String(error),
          platform: "twitch",
          status: errObj?.status,
        });
      }

      // Return stale cache if available during errors (except rate limits)
      if (errObj?.status !== 429 && this.userInfoCache) {
        this.logStorage.addLog(
          "info",
          "Using stale cached user info due to error",
          { platform: "twitch" },
        );
        return this.userInfoCache.data;
      }

      // Re-throw with proper error code
      if (errObj?.status === 429) {
        const rateLimitError: Error & { status?: number } = new Error(
          "Rate limit exceeded. Please wait before trying again.",
        );
        rateLimitError.status = 429;
        throw rateLimitError;
      }
      return null;
    }
  }

  async sendChatMessage(
    channelName: string,
    message: string,
  ): Promise<boolean> {
    try {
      const config = await this.getConfig();
      if (!config || !config.enabled) {
        this.logStorage.addLog("error", "Twitch not configured or disabled", {
          platform: "twitch",
        });
        return false;
      }

      // Twitch chat messages have a 500 character limit
      if (message.length > 500) {
        message = message.substring(0, 497) + "...";
      }

      // Use Twitch API to send chat message
      const response = await fetchWithTimeout(
        "https://api.twitch.tv/helix/chat/messages",
        {
          timeout: 10000,
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            "Client-Id": config.clientId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            broadcaster_id: await this.getBroadcasterId(
              config.channelName,
              config,
            ),
            sender_id: await this.getUserId(config),
            message: message,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Twitch API error: ${response.status} ${response.statusText}`,
        );
      }

      this.logStorage.addLog("info", "Twitch chat message sent successfully", {
        channelName,
        message: message,
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

  private async getBroadcasterId(
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

    const data = await response.json() as { data?: Array<{ id: string }> };
    return data.data?.[0]?.id || "";
  }

  private async getUserId(config: TwitchConfig): Promise<string> {
    const userInfo = await this.getUserInfo(config);
    return userInfo?.id || "";
  }

  // Method to process incoming chat messages
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

      // Here you would typically:
      // 1. Check if message should trigger a response
      // 2. Process commands if enabled
      // 3. Generate AI response if configured
      // 4. Apply rate limiting and moderation

      // For now, just log the message
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
