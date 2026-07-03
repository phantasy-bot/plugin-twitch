import {
  createPluginModuleLogger,
  LogStorage,
  type ServerEnv,
} from "@phantasy/agent/plugin-runtime";

import { TwitchIntegration, TwitchChatMessage } from "../twitch-integration";
import { TwitchAdvancedConfig } from "../twitch-config";
import type { TwitchConfig } from "../twitch-integration";
import { TwitchChatResponseHandler } from "./twitch-chat-response";

const logger = createPluginModuleLogger("TwitchBotService");

/** tmi.js ChatUserstate-compatible type for incoming messages */
interface TwitchUserState {
  id?: string;
  username?: string;
  "display-name"?: string;
  color?: string;
  badges?: Record<string, string>;
  emotes?: Record<string, string[]>;
  mod?: boolean;
  subscriber?: boolean;
  vip?: boolean;
  [key: string]: unknown;
}

interface TwitchIRCClient {
  connect(): Promise<[string, number]>;
  disconnect(): Promise<[string, number]>;
  join(channel: string): Promise<[string]>;
  part(channel: string): Promise<[string]>;
  say(channel: string, message: string): Promise<[string]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): void;
  readyState(): string;
}

export class TwitchBotService {
  private twitchIntegration: TwitchIntegration;
  private logStorage: LogStorage;
  private chatResponseHandler: TwitchChatResponseHandler;
  private client: TwitchIRCClient | null = null;
  private isConnected = false;
  private config: TwitchConfig | null = null;
  private advanced: TwitchAdvancedConfig | null = null;
  private messageQueue: Array<{
    channel: string;
    message: string;
    timestamp: number;
  }> = [];
  private lastMessageTime = 0;
  private env: ServerEnv;

  constructor(env: ServerEnv) {
    this.env = env;
    this.twitchIntegration = new TwitchIntegration(env);
    this.logStorage = LogStorage.getInstance();
    this.chatResponseHandler = new TwitchChatResponseHandler({
      env,
      config: null,
      advanced: null,
      getLastMessageTime: () => this.lastMessageTime,
      sendMessage: (channel, message) => this.sendMessage(channel, message),
    });
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info("Starting Twitch bot service...");

      this.config = await this.twitchIntegration.getConfig();
      if (!this.config || !this.config.enabled) {
        throw new Error("Twitch integration not configured or disabled");
      }

      this.advanced = this.config.advanced || null;
      this.chatResponseHandler = new TwitchChatResponseHandler({
        env: this.env,
        config: this.config,
        advanced: this.advanced,
        getLastMessageTime: () => this.lastMessageTime,
        sendMessage: (channel, message) => this.sendMessage(channel, message),
      });

      if (!this.config.accessToken || !this.config.channelName) {
        throw new Error("Missing required Twitch credentials");
      }

      await this.connectToTwitchIRC();

      this.logStorage.addLog("info", "Twitch bot started successfully", {
        platform: "twitch",
        channel: this.config.channelName,
        username: this.config.username,
      });

      return { success: true };
    } catch (error) {
      logger.error("Failed to start Twitch bot:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logStorage.addLog("error", "Failed to start Twitch bot", {
        error: errorMessage,
        platform: "twitch",
      });
      return { success: false, error: errorMessage };
    }
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info("Stopping Twitch bot service...");

      if (this.client) {
        await this.client.disconnect();
        this.client = null;
      }

      this.isConnected = false;
      this.config = null;
      this.advanced = null;

      this.logStorage.addLog("info", "Twitch bot stopped successfully", {
        platform: "twitch",
      });

      return { success: true };
    } catch (error) {
      logger.error("Failed to stop Twitch bot:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logStorage.addLog("error", "Failed to stop Twitch bot", {
        error: errorMessage,
        platform: "twitch",
      });
      return { success: false, error: errorMessage };
    }
  }

  getStatus(): string {
    if (!this.config || !this.config.enabled) {
      return "disabled";
    }
    if (this.isConnected && this.client?.readyState() === "OPEN") {
      return "connected";
    }
    if (this.client) {
      return "connecting";
    }
    return "disconnected";
  }

  private async connectToTwitchIRC(): Promise<void> {
    if (!this.config) {
      throw new Error("No Twitch configuration available");
    }

    try {
      const tmi = await import("tmi.js");
      const Client = tmi.default?.client || tmi.client;

      this.client = new Client({
        options: {
          debug: process.env.NODE_ENV === "development",
          messagesLogLevel: "info",
        },
        connection: {
          secure: true,
          reconnect: true,
          maxReconnectAttempts: 5,
          maxReconnectInterval: 30000,
        },
        identity: {
          username: this.config.username || this.config.channelName,
          password: `oauth:${this.config.accessToken}`,
        },
        channels: [`#${this.config.channelName}`],
      }) as TwitchIRCClient;

      this.client.on("message", this.handleChatMessage.bind(this));

      this.client.on("connected", (address: string, port: number) => {
        this.isConnected = true;
        logger.info(`Connected to Twitch IRC at ${address}:${port}`);
        this.logStorage.addLog("info", "Connected to Twitch IRC", {
          platform: "twitch",
          address,
          port,
        });
      });

      this.client.on("disconnected", (reason: string) => {
        this.isConnected = false;
        logger.info(`Disconnected from Twitch IRC: ${reason}`);
        this.logStorage.addLog("warn", "Disconnected from Twitch IRC", {
          platform: "twitch",
          reason,
        });
      });

      this.client.on("reconnect", () => {
        logger.info("Reconnecting to Twitch IRC...");
      });

      this.client.on("error", (error: Error) => {
        logger.error("Twitch IRC error:", error);
        this.logStorage.addLog("error", "Twitch IRC connection error", {
          platform: "twitch",
          error: error.message,
        });
      });

      await this.client.connect();

      logger.info(
        `Twitch IRC client initialized for channel: ${this.config.channelName}`,
      );
    } catch (error) {
      logger.error("Failed to initialize Twitch IRC client:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to connect to Twitch IRC: ${errorMessage}. ` +
          `Ensure tmi.js is installed: pnpm add tmi.js`,
      );
    }
  }

  private async handleChatMessage(
    channel: string,
    userstate: TwitchUserState,
    messageText: string,
    self: boolean,
  ): Promise<void> {
    try {
      if (self || !this.config || !this.advanced) return;

      const username = userstate.username || "anonymous";
      const chatMessage: TwitchChatMessage = {
        id: userstate.id || Date.now().toString(),
        username,
        displayName: userstate["display-name"] || username || "Anonymous",
        color: userstate.color,
        badges: userstate.badges || {},
        message: messageText,
        timestamp: new Date(),
        userState: userstate,
        channel: channel.replace("#", ""),
        emotes: userstate.emotes,
        isMod: userstate.mod || false,
        isSubscriber: userstate.subscriber || false,
        isVip: userstate.vip || false,
        isBroadcaster: username.toLowerCase() === this.config.channelName.toLowerCase(),
      };

      this.twitchIntegration.processChatMessage(chatMessage);
      await this.chatResponseHandler.processMessageForResponse(chatMessage);
    } catch (error) {
      logger.error("Error handling chat message:", error);
      this.logStorage.addLog("error", "Failed to handle chat message", {
        error: error instanceof Error ? error.message : String(error),
        platform: "twitch",
      });
    }
  }

  private async sendMessage(channel: string, message: string): Promise<void> {
    if (!this.client || !this.isConnected || !this.config) return;

    try {
      this.messageQueue.push({
        channel,
        message,
        timestamp: Date.now(),
      });

      await this.processMessageQueue();
    } catch (error) {
      logger.error("Error sending message:", error);
    }
  }

  private async processMessageQueue(): Promise<void> {
    if (!this.client || this.messageQueue.length === 0 || !this.advanced) return;

    const now = Date.now();
    const cooldown = this.advanced.rateLimits.cooldownBetweenMessages * 1000;

    if (now - this.lastMessageTime < cooldown) {
      setTimeout(
        () => this.processMessageQueue(),
        cooldown - (now - this.lastMessageTime),
      );
      return;
    }

    const messageToSend = this.messageQueue.shift();
    if (messageToSend) {
      await this.client.say(`#${messageToSend.channel}`, messageToSend.message);
      this.lastMessageTime = now;

      this.logStorage.addLog("info", "Sent Twitch chat message", {
        platform: "twitch",
        channel: messageToSend.channel,
        message: messageToSend.message,
      });
    }

    if (this.messageQueue.length > 0) {
      setTimeout(() => this.processMessageQueue(), cooldown);
    }
  }
}
