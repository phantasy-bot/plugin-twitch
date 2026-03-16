import {
  AGENT_DEFAULTS,
  AgentService,
  createPluginModuleLogger,
  LogStorage,
  type ServerEnv,
} from "@phantasy/agent/plugin-runtime";
import {
  TwitchIntegration,
  TwitchConfig,
  TwitchChatMessage,
} from "../twitch-integration";
import { TwitchAdvancedConfig } from "../twitch-config";

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

// Simple Twitch IRC client interface
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
  private agentService: AgentService;
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
  private commandCooldowns = new Map<string, number>();
  private env: ServerEnv;

  constructor(env: ServerEnv) {
    this.env = env;
    this.twitchIntegration = new TwitchIntegration(env);
    this.logStorage = LogStorage.getInstance();
    this.agentService = new AgentService(env);
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info("🚀 Starting Twitch bot service...");

      // Get configuration
      this.config = await this.twitchIntegration.getConfig();
      if (!this.config || !this.config.enabled) {
        throw new Error("Twitch integration not configured or disabled");
      }

      this.advanced = this.config.advanced || null;

      // Validate required credentials
      if (!this.config.accessToken || !this.config.channelName) {
        throw new Error("Missing required Twitch credentials");
      }

      // Initialize IRC client (simplified - would use actual Twitch IRC library)
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
      logger.info("🛑 Stopping Twitch bot service...");

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
      // Import tmi.js dynamically to avoid loading if not needed
      const tmi = await import("tmi.js");
      const Client = tmi.default?.client || tmi.client;

      // Create Twitch IRC client
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

      // Set up event handlers
      this.client.on("message", this.handleChatMessage.bind(this));

      this.client.on("connected", (address: string, port: number) => {
        this.isConnected = true;
        logger.info(`✅ Connected to Twitch IRC at ${address}:${port}`);
        this.logStorage.addLog("info", "Connected to Twitch IRC", {
          platform: "twitch",
          address,
          port,
        });
      });

      this.client.on("disconnected", (reason: string) => {
        this.isConnected = false;
        logger.info(`❌ Disconnected from Twitch IRC: ${reason}`);
        this.logStorage.addLog("warn", "Disconnected from Twitch IRC", {
          platform: "twitch",
          reason,
        });
      });

      this.client.on("reconnect", () => {
        logger.info("🔄 Reconnecting to Twitch IRC...");
      });

      this.client.on("error", (error: Error) => {
        logger.error("❌ Twitch IRC error:", error);
        this.logStorage.addLog("error", "Twitch IRC connection error", {
          platform: "twitch",
          error: error.message,
        });
      });

      // Connect to Twitch IRC
      await this.client.connect();

      logger.info(
        `🎮 Twitch IRC client initialized for channel: ${this.config.channelName}`,
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

      // Parse the chat message
      const username = userstate.username || "anonymous";
      const chatMessage: TwitchChatMessage = {
        id: userstate.id || Date.now().toString(),
        username,
        displayName:
          userstate["display-name"] || username || "Anonymous",
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
        isBroadcaster: username === this.config.channelName,
      };

      // Process the message through the integration
      this.twitchIntegration.processChatMessage(chatMessage);

      // Check if we should respond
      await this.processMessageForResponse(chatMessage);
    } catch (error) {
      logger.error("Error handling chat message:", error);
      this.logStorage.addLog("error", "Failed to handle chat message", {
        error: error instanceof Error ? error.message : String(error),
        platform: "twitch",
      });
    }
  }

  private async processMessageForResponse(
    message: TwitchChatMessage,
  ): Promise<void> {
    if (!this.advanced?.chatResponse.enabled || !this.config) return;

    try {
      // Check rate limits
      if (!this.checkRateLimit()) {
        return;
      }

      // Check if message should trigger a response
      let shouldRespond = false;
      let responseType = "";

      // Check for mentions
      if (this.advanced.chatResponse.respondToMentions) {
        const mentions = [
          "@" + (this.config.username || ""),
          this.config.username || "",
        ];
        if (
          mentions.some((mention) =>
            message.message.toLowerCase().includes(mention.toLowerCase()),
          )
        ) {
          shouldRespond = true;
          responseType = "mention";
        }
      }

      // Check for commands
      if (
        this.advanced.chatResponse.respondToCommands &&
        message.message.startsWith("!")
      ) {
        const command = await this.handleCommand(message);
        if (command) {
          shouldRespond = true;
          responseType = "command";
        }
      }

      // Check for keywords
      if (
        this.advanced.chatResponse.respondToKeywords &&
        this.advanced.chatResponse.keywords
      ) {
        const hasKeyword = this.advanced.chatResponse.keywords.some((keyword) =>
          message.message.toLowerCase().includes(keyword.toLowerCase()),
        );
        if (hasKeyword) {
          shouldRespond = true;
          responseType = "keyword";
        }
      }

      // Check user requirements
      if (shouldRespond) {
        if (
          this.advanced.chatResponse.requireFollower &&
          !(message.userState.badges as Record<string, string> | undefined)?.follower
        ) {
          return;
        }
        if (
          this.advanced.chatResponse.requireSubscriber &&
          !message.isSubscriber
        ) {
          return;
        }
        if (
          this.advanced.chatResponse.ignoreBots &&
          this.isBot(message.username)
        ) {
          return;
        }

        // Generate and send response
        await this.generateAndSendResponse(message, responseType);
      }
    } catch (error) {
      logger.error("Error processing message for response:", error);
    }
  }

  private async handleCommand(message: TwitchChatMessage): Promise<boolean> {
    if (!this.advanced?.commands) return false;

    const commandText = message.message.split(" ")[0].toLowerCase();
    const command = this.advanced.commands.find(
      (cmd) => cmd.enabled && cmd.trigger.toLowerCase() === commandText,
    );

    if (!command) return false;

    // Check cooldown
    const cooldownKey = `${command.id}_${message.username}`;
    const now = Date.now();
    const lastUsed = this.commandCooldowns.get(cooldownKey) || 0;

    if (now - lastUsed < (command.cooldown || 0) * 1000) {
      return false;
    }

    // Check permissions
    if (command.modOnly && !message.isMod && !message.isBroadcaster) {
      return false;
    }
    if (
      command.subOnly &&
      !message.isSubscriber &&
      !message.isMod &&
      !message.isBroadcaster
    ) {
      return false;
    }

    // Send command response
    await this.sendMessage(message.channel, command.response);
    this.commandCooldowns.set(cooldownKey, now);

    return true;
  }

  private async generateAndSendResponse(
    message: TwitchChatMessage,
    responseType: string,
  ): Promise<void> {
    try {
      // Add delay before responding
      if (this.advanced?.chatResponse.responseDelay) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.advanced!.chatResponse.responseDelay * 1000),
        );
      }

      // Use AI to generate context-aware response
      logger.info(
        `[TwitchBot] Generating AI response for ${responseType} from @${message.username}`,
      );

      try {
        // Build context-aware prompt based on response type
        let userMessage = message.message;

        // Add context to help AI understand the situation
        const contextPrefix =
          responseType === "mention"
            ? `${message.displayName} mentioned you in Twitch chat: `
            : responseType === "keyword"
              ? `${message.displayName} said in Twitch chat: `
              : `${message.displayName} sent a command in Twitch chat: `;

        const fullMessage = contextPrefix + userMessage;

        // Call AgentService to generate AI response
        const aiResponse = await this.agentService.processMessage(
          AGENT_DEFAULTS.ID,
          fullMessage,
          {
            platform: "twitch",
            userId: message.id,
            username: message.username,
            channelId: message.channel,
            metadata: {
              displayName: message.displayName,
              badges: message.badges,
              isMod: message.isMod,
              isSubscriber: message.isSubscriber,
              isVip: message.isVip,
              isBroadcaster: message.isBroadcaster,
              responseType,
            },
          },
        );

        // Format response with @ mention
        let response = aiResponse.text.trim();

        // Keep responses concise for Twitch (max 500 chars to stay within rate limits)
        if (response.length > 480) {
          response = response.substring(0, 477) + "...";
        }

        // Add @ mention if not already present and it's a mention/keyword response
        if (
          (responseType === "mention" || responseType === "keyword") &&
          !response.startsWith(`@${message.displayName}`)
        ) {
          response = `@${message.displayName} ${response}`;
        }

        await this.sendMessage(message.channel, response);

        logger.info(
          `[TwitchBot] AI response sent (${response.length} chars) to @${message.username}`,
        );
      } catch (aiError) {
        // Fallback to simple responses if AI fails
        logger.error(
          "[TwitchBot] AI generation failed, using fallback:",
          aiError,
        );

        let fallbackResponse = "";
        switch (responseType) {
          case "mention":
            fallbackResponse = `@${message.displayName} Hello! How can I help you today? 🤖`;
            break;
          case "keyword":
            fallbackResponse = `@${message.displayName} That's interesting! Tell me more about that.`;
            break;
          default:
            fallbackResponse = `@${message.displayName} Thanks for chatting! 😊`;
        }

        await this.sendMessage(message.channel, fallbackResponse);
      }
    } catch (error) {
      logger.error("Error generating response:", error);
    }
  }

  private async sendMessage(channel: string, message: string): Promise<void> {
    if (!this.client || !this.isConnected || !this.config) return;

    try {
      // Add to queue with rate limiting
      this.messageQueue.push({
        channel,
        message,
        timestamp: Date.now(),
      });

      // Process queue
      await this.processMessageQueue();
    } catch (error) {
      logger.error("Error sending message:", error);
    }
  }

  private async processMessageQueue(): Promise<void> {
    if (!this.client || this.messageQueue.length === 0 || !this.advanced)
      return;

    const now = Date.now();
    const cooldown = this.advanced.rateLimits.cooldownBetweenMessages * 1000;

    if (now - this.lastMessageTime < cooldown) {
      // Schedule next processing
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

    // Continue processing queue if there are more messages
    if (this.messageQueue.length > 0) {
      setTimeout(() => this.processMessageQueue(), cooldown);
    }
  }

  private checkRateLimit(): boolean {
    if (!this.advanced) return false;

    // Simple rate limiting - in production would use more sophisticated tracking
    const now = Date.now();
    const minute = 60 * 1000;

    // For simplicity, just check if we're not sending too frequently
    if (
      now - this.lastMessageTime <
      this.advanced.rateLimits.cooldownBetweenMessages * 1000
    ) {
      return false;
    }

    return true;
  }

  private isBot(username: string): boolean {
    const botPatterns = ["bot", "nightbot", "streamlabs", "moobot", "fossabot"];
    return botPatterns.some((pattern) =>
      username.toLowerCase().includes(pattern),
    );
  }
}
