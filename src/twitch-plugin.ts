import {
  BasePlugin,
  type PlatformCapability,
  type PluginConfig,
  type PluginTool,
} from "@phantasy/agent/plugins";
import {
  createPluginModuleLogger,
  getPluginRuntimeEnv,
  type ServerEnv,
} from "@phantasy/agent/plugin-runtime";

import { handleTwitchPluginEndpoint } from "./twitch-plugin-endpoints";
import {
  TwitchIntegration,
  type TwitchConfig,
  type TwitchUserInfo,
} from "./twitch-integration";
import { defaultTwitchAdvancedConfig, type TwitchStreamStatus } from "./twitch-config";
import { TwitchBotService } from "./runtime/twitch-bot-service";
import { buildTwitchRuntimeConfig, buildTwitchUrl } from "./runtime/twitch-plugin-config";

const log = createPluginModuleLogger("TwitchPlugin");

type TwitchPluginConfig = PluginConfig & Partial<TwitchConfig>;

export class TwitchPlugin extends BasePlugin implements PlatformCapability {
  name = "twitch";
  version = "0.1.0";
  description = "Twitch streaming and chat integration for Phantasy.";

  protected displayName = "Twitch";
  protected category = "streaming";
  protected tags = ["twitch", "streaming", "chat", "creator"];
  protected permissions = ["internet"];
  protected workspace = "business" as const;
  protected extensionKind = "integration" as const;
  protected isPlatform = true;
  protected platformFeatures = {
    messaging: true,
    streaming: true,
    autonomous: true,
  } as const;
  protected adminSurface = {
    tabId: "twitch",
    label: "Twitch",
    section: "business",
    workspace: "business",
    kind: "generic",
    keywords: ["twitch", "streaming", "chat", "creator"],
    dashboardIcon: "twitch",
  } as const;
  protected configSchema = {
    type: "object",
    properties: {
      enabled: { type: "boolean", default: true, title: "Enabled" },
      autoStart: {
        type: "boolean",
        default: false,
        title: "Auto-start",
        description:
          "Reconnect the Twitch bot automatically when this integration is enabled.",
      },
      clientId: { type: "string", title: "Client ID" },
      clientSecret: { type: "string", title: "Client secret", format: "password" },
      accessToken: { type: "string", title: "Access token", format: "password" },
      refreshToken: { type: "string", title: "Refresh token", format: "password" },
      channelName: { type: "string", title: "Channel name" },
      username: { type: "string", title: "Bot username" },
      advanced: {
        type: "object",
        additionalProperties: true,
        default: defaultTwitchAdvancedConfig,
      },
    },
  };

  private botService: TwitchBotService | null = null;
  private lastActivity?: Date;
  private streamStatus: TwitchStreamStatus = {
    live: false,
  };

  getTools(): PluginTool[] {
    return [];
  }

  override async onInit(
    _agentConfig: Record<string, unknown>,
    config?: TwitchPluginConfig,
  ): Promise<void> {
    await super.onInit(_agentConfig, config);
    const runtimeConfig = await this.buildRuntimeConfig();
    if (runtimeConfig) {
      await this.createIntegration().saveConfig(runtimeConfig);
    }

    if (this.isEnabled() && runtimeConfig?.autoStart && !this.botService) {
      const result = await this.startBot();
      if (!result.success) {
        log.warn("Twitch auto-start failed", { message: result.message });
      }
    }
  }

  async startBot(): Promise<{ success: boolean; message?: string }> {
    const runtimeConfig = await this.buildRuntimeConfig();
    if (!runtimeConfig) {
      return {
        success: false,
        message:
          "Set Twitch credentials, access token, and channel name before starting the integration.",
      };
    }

    const integration = this.createIntegration();
    const testResult = await integration.testConnection(runtimeConfig);
    if (!testResult.success) {
      return {
        success: false,
        message: testResult.error || "Failed to connect to Twitch",
      };
    }

    const nextConfig = {
      ...runtimeConfig,
      username: testResult.userInfo?.login || runtimeConfig.username,
      connected: true,
    };
    await integration.saveConfig(nextConfig);

    if (this.botService) {
      await this.botService.stop();
    }

    this.botService = new TwitchBotService(this.getRuntimeEnv());
    const result = await this.botService.start();
    if (!result.success) {
      return {
        success: false,
        message: result.error || "Failed to start Twitch bot service",
      };
    }

    this.lastActivity = new Date();
    this.streamStatus = {
      ...this.streamStatus,
      live: false,
      url: buildTwitchUrl(nextConfig.channelName),
    };

    return {
      success: true,
      message: nextConfig.username
        ? `Connected to Twitch as ${nextConfig.username}`
        : "Connected to Twitch",
    };
  }

  async stopBot(): Promise<{ success: boolean; message?: string }> {
    if (this.botService) {
      await this.botService.stop();
      this.botService = null;
    }

    const runtimeConfig = await this.buildRuntimeConfig();
    if (runtimeConfig) {
      await this.createIntegration().saveConfig({
        ...runtimeConfig,
        connected: false,
      });
    }

    this.streamStatus = {
      ...this.streamStatus,
      live: false,
      viewerCount: 0,
    };

    return {
      success: true,
      message: "Twitch integration stopped",
    };
  }

  async getBotStatus(): Promise<{
    connected: boolean;
    streaming?: boolean;
    autonomousPosting?: boolean;
    lastActivity?: Date;
    error?: string;
  }> {
    const runtimeConfig = await this.buildRuntimeConfig();
    if (!runtimeConfig) {
      return {
        connected: false,
        streaming: this.streamStatus.live,
        autonomousPosting: true,
        lastActivity: this.lastActivity,
        error:
          "Twitch credentials are incomplete. Add client credentials, access token, and channel name.",
      };
    }

    if (this.botService) {
      return {
        connected: this.botService.getStatus() === "connected",
        streaming: this.streamStatus.live,
        autonomousPosting: true,
        lastActivity: this.lastActivity,
        error: undefined,
      };
    }

    const storedConfig = await this.createIntegration().getConfig();
    return {
      connected: Boolean(storedConfig?.connected),
      streaming: this.streamStatus.live,
      autonomousPosting: true,
      lastActivity: this.lastActivity,
      error: storedConfig?.connected
        ? undefined
        : "Twitch integration is configured but not started",
    };
  }

  async onConfigUpdated(newConfig: PluginConfig): Promise<void> {
    await super.onConfigUpdated(newConfig);
    const runtimeConfig = await this.buildRuntimeConfig();
    if (runtimeConfig) {
      await this.createIntegration().saveConfig(runtimeConfig);
      this.streamStatus = {
        ...this.streamStatus,
        url: buildTwitchUrl(runtimeConfig.channelName),
      };
    }
  }

  async handleCustomEndpoint(request: Request, path: string): Promise<Response | null> {
    try {
      return handleTwitchPluginEndpoint(this, request, path);
    } catch (error) {
      log.error("Twitch plugin endpoint failed", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response(
        JSON.stringify({ success: false, error: "Twitch plugin request failed" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  async testConnection(
    config: Pick<
      TwitchConfig,
      "clientId" | "clientSecret" | "accessToken" | "channelName" | "refreshToken"
    >,
  ): Promise<{ success: boolean; error?: string; userInfo?: TwitchUserInfo }> {
    return this.createIntegration().testConnection(config);
  }

  async buildRuntimeConfig(
    overrides?: Partial<TwitchConfig>,
  ): Promise<TwitchConfig | null> {
    const snapshot = (this.getConfig() || {}) as TwitchPluginConfig;
    const stored = await this.createIntegration().getConfig();
    return buildTwitchRuntimeConfig({ overrides, snapshot, stored });
  }

  getStreamStatus(): TwitchStreamStatus {
    return this.streamStatus;
  }

  setStreamStatus(status: TwitchStreamStatus): void {
    this.streamStatus = status;
  }

  touchLastActivity(): void {
    this.lastActivity = new Date();
  }

  private createIntegration(): TwitchIntegration {
    return new TwitchIntegration(this.getRuntimeEnv());
  }

  private getRuntimeEnv(): ServerEnv {
    return getPluginRuntimeEnv() as unknown as ServerEnv;
  }
}

export default TwitchPlugin;
