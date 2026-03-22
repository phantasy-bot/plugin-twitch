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

import {
  TwitchIntegration,
  type TwitchConfig,
} from "./twitch-integration";
import {
  defaultTwitchAdvancedConfig,
  type TwitchAdvancedConfig,
  type TwitchStreamStatus,
} from "./twitch-config";
import { TwitchBotService } from "./runtime/twitch-bot-service";

const log = createPluginModuleLogger("TwitchPlugin");

type TwitchPluginConfig = PluginConfig & Partial<TwitchConfig>;

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
      enabled: { type: "boolean", default: true },
      clientId: { type: "string" },
      clientSecret: { type: "string" },
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
      channelName: { type: "string" },
      username: { type: "string" },
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
      connected: false,
      streaming: this.streamStatus.live,
      autonomousPosting: true,
      lastActivity: this.lastActivity,
      error: storedConfig
        ? "Twitch integration is configured but not started"
        : undefined,
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

  async handleCustomEndpoint(
    request: Request,
    path: string,
  ): Promise<Response | null> {
    try {
      if (path === "/status" && request.method === "GET") {
        const runtimeConfig = await this.buildRuntimeConfig();
        const status = await this.getBotStatus();
        return jsonResponse({
          enabled: this.isEnabled(),
          connected: status.connected,
          error: status.error,
          lastActivity: status.lastActivity,
          live: this.streamStatus.live,
          title: this.streamStatus.title || null,
          gameName: this.streamStatus.gameName || null,
          viewerCount: this.streamStatus.viewerCount,
          url: this.streamStatus.url,
          channelName: runtimeConfig?.channelName,
          username: runtimeConfig?.username,
        });
      }

      if (path === "/start" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (body && typeof body === "object" && body.config) {
          await this.updateConfig(body.config as Partial<TwitchPluginConfig>);
        }

        const result = await this.startBot();
        return jsonResponse(result, result.success ? 200 : 400);
      }

      if (path === "/stop" && request.method === "POST") {
        const result = await this.stopBot();
        return jsonResponse(result, result.success ? 200 : 400);
      }

      if (
        (path === "/test" || path === "/test-connection") &&
        request.method === "POST"
      ) {
        const body = await request.json().catch(() => ({}));
        const runtimeConfig = await this.buildRuntimeConfig(
          (body || {}) as Partial<TwitchConfig>,
        );

        if (!runtimeConfig) {
          return jsonResponse(
            { success: false, error: "Twitch credentials are incomplete" },
            400,
          );
        }

        const result = await this.createIntegration().testConnection(runtimeConfig);
        return jsonResponse(
          {
            ...result,
            connected: result.success,
            username: result.userInfo?.login,
            userId: result.userInfo?.id,
          },
          result.success ? 200 : 400,
        );
      }

      if (path === "/action/go-live" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const runtimeConfig = await this.buildRuntimeConfig();

        this.streamStatus = {
          ...this.streamStatus,
          live: true,
          title:
            typeof body?.title === "string" && body.title.trim().length > 0
              ? body.title.trim()
              : "Live with Phantasy",
          url: buildTwitchUrl(runtimeConfig?.channelName),
          viewerCount: 0,
        };
        this.lastActivity = new Date();

        return jsonResponse({
          success: true,
          live: true,
          title: this.streamStatus.title,
          url: this.streamStatus.url,
        });
      }

      if (path === "/action/end" && request.method === "POST") {
        this.streamStatus = {
          ...this.streamStatus,
          live: false,
          viewerCount: 0,
        };
        this.lastActivity = new Date();
        return jsonResponse({
          success: true,
          live: false,
          title: this.streamStatus.title,
          url: this.streamStatus.url,
        });
      }

      return null;
    } catch (error) {
      log.error("Twitch plugin endpoint failed", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonResponse(
        { success: false, error: "Twitch plugin request failed" },
        500,
      );
    }
  }

  private createIntegration(): TwitchIntegration {
    return new TwitchIntegration(this.getRuntimeEnv());
  }

  private getRuntimeEnv(): ServerEnv {
    return getPluginRuntimeEnv() as unknown as ServerEnv;
  }

  private getConfigSnapshot(): TwitchPluginConfig {
    return (this.getConfig() || {}) as TwitchPluginConfig;
  }

  private async buildRuntimeConfig(
    overrides?: Partial<TwitchConfig>,
  ): Promise<TwitchConfig | null> {
    const snapshot = this.getConfigSnapshot();
    const stored = await this.createIntegration().getConfig();
    const runtimeConfig: TwitchConfig = {
      clientId: readRequiredString(
        overrides?.clientId,
        snapshot.clientId,
        stored?.clientId,
      ),
      clientSecret: readRequiredString(
        overrides?.clientSecret,
        snapshot.clientSecret,
        stored?.clientSecret,
      ),
      accessToken: readRequiredString(
        overrides?.accessToken,
        snapshot.accessToken,
        stored?.accessToken,
      ),
      refreshToken: readRequiredString(
        overrides?.refreshToken,
        snapshot.refreshToken,
        stored?.refreshToken,
      ),
      channelName: readRequiredString(
        overrides?.channelName,
        snapshot.channelName,
        stored?.channelName,
      ),
      enabled:
        readOptionalBoolean(overrides?.enabled, snapshot.enabled, stored?.enabled) ?? true,
      connected: stored?.connected,
      username: readOptionalString(
        overrides?.username,
        snapshot.username,
        stored?.username,
      ),
      advanced: readConfigObject<TwitchAdvancedConfig>(
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
}

function buildTwitchUrl(channelName?: string): string | undefined {
  return channelName ? `https://twitch.tv/${channelName}` : undefined;
}

function readRequiredString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

function readOptionalString(...values: Array<unknown>): string | undefined {
  const value = readRequiredString(...values);
  return value || undefined;
}

function readOptionalBoolean(...values: Array<unknown>): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
}

function readConfigObject<T extends object>(
  ...values: Array<unknown>
): T | undefined {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as T;
    }
  }

  return undefined;
}

export default TwitchPlugin;
