import {
  AGENT_DEFAULTS,
  AgentService,
  createPluginModuleLogger,
  type ServerEnv,
} from "@phantasy/agent/plugin-runtime";

import type { TwitchAdvancedConfig } from "../twitch-config";
import type { TwitchChatMessage, TwitchConfig } from "../twitch-integration";

const logger = createPluginModuleLogger("TwitchChatResponse");

export interface TwitchChatResponseContext {
  env: ServerEnv;
  config: TwitchConfig | null;
  advanced: TwitchAdvancedConfig | null;
  getLastMessageTime: () => number;
  sendMessage: (channel: string, message: string) => Promise<void>;
}

export class TwitchChatResponseHandler {
  private agentService: AgentService;
  private commandCooldowns = new Map<string, number>();

  constructor(private readonly context: TwitchChatResponseContext) {
    this.agentService = new AgentService(context.env);
  }

  async processMessageForResponse(message: TwitchChatMessage): Promise<void> {
    const { advanced, config } = this.context;
    if (!advanced?.chatResponse.enabled || !config) return;

    try {
      if (!this.checkRateLimit()) {
        return;
      }

      let shouldRespond = false;
      let responseType = "";

      if (advanced.chatResponse.respondToMentions) {
        const mentions = Array.from(
          new Set(
            [config.username, config.channelName]
              .map((value) => value?.trim().toLowerCase())
              .filter((value): value is string => Boolean(value))
              .flatMap((value) => [`@${value}`, value]),
          ),
        );
        if (
          mentions.length > 0 &&
          mentions.some((mention) => message.message.toLowerCase().includes(mention))
        ) {
          shouldRespond = true;
          responseType = "mention";
        }
      }

      if (advanced.chatResponse.respondToCommands && message.message.startsWith("!")) {
        const handledCommand = await this.handleCommand(message);
        if (handledCommand) {
          return;
        }
      }

      if (advanced.chatResponse.respondToKeywords && advanced.chatResponse.keywords) {
        const hasKeyword = advanced.chatResponse.keywords.some((keyword) =>
          message.message.toLowerCase().includes(keyword.toLowerCase()),
        );
        if (hasKeyword) {
          shouldRespond = true;
          responseType = "keyword";
        }
      }

      if (shouldRespond) {
        if (
          advanced.chatResponse.requireFollower &&
          !(message.userState.badges as Record<string, string> | undefined)?.follower
        ) {
          return;
        }
        if (advanced.chatResponse.requireSubscriber && !message.isSubscriber) {
          return;
        }
        if (advanced.chatResponse.ignoreBots && this.isBot(message.username)) {
          return;
        }

        await this.generateAndSendResponse(message, responseType);
      }
    } catch (error) {
      logger.error("Error processing message for response:", error);
    }
  }

  private async handleCommand(message: TwitchChatMessage): Promise<boolean> {
    const advanced = this.context.advanced;
    if (!advanced?.commands) return false;

    const commandText = message.message.split(" ")[0].toLowerCase();
    const command = advanced.commands.find(
      (cmd) => cmd.enabled && cmd.trigger.toLowerCase() === commandText,
    );

    if (!command) return false;

    const cooldownKey = `${command.id}_${message.username}`;
    const now = Date.now();
    const lastUsed = this.commandCooldowns.get(cooldownKey) || 0;

    if (now - lastUsed < (command.cooldown || 0) * 1000) {
      return false;
    }

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

    await this.context.sendMessage(message.channel, command.response);
    this.commandCooldowns.set(cooldownKey, now);

    return true;
  }

  private async generateAndSendResponse(
    message: TwitchChatMessage,
    responseType: string,
  ): Promise<void> {
    const advanced = this.context.advanced;
    try {
      if (advanced?.chatResponse.responseDelay) {
        await new Promise((resolve) =>
          setTimeout(resolve, advanced.chatResponse.responseDelay * 1000),
        );
      }

      logger.info(
        `[TwitchBot] Generating AI response for ${responseType} from @${message.username}`,
      );

      try {
        const userMessage = message.message;
        const contextPrefix =
          responseType === "mention"
            ? `${message.displayName} mentioned you in Twitch chat: `
            : responseType === "keyword"
              ? `${message.displayName} said in Twitch chat: `
              : `${message.displayName} sent a command in Twitch chat: `;

        const fullMessage = contextPrefix + userMessage;

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

        let response = aiResponse.text.trim();

        if (response.length > 480) {
          response = response.substring(0, 477) + "...";
        }

        if (
          (responseType === "mention" || responseType === "keyword") &&
          !response.startsWith(`@${message.displayName}`)
        ) {
          response = `@${message.displayName} ${response}`;
        }

        await this.context.sendMessage(message.channel, response);

        logger.info(
          `[TwitchBot] AI response sent (${response.length} chars) to @${message.username}`,
        );
      } catch (aiError) {
        logger.error("[TwitchBot] AI generation failed, using fallback:", aiError);

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

        await this.context.sendMessage(message.channel, fallbackResponse);
      }
    } catch (error) {
      logger.error("Error generating response:", error);
    }
  }

  private checkRateLimit(): boolean {
    const advanced = this.context.advanced;
    if (!advanced) return false;

    const now = Date.now();
    if (
      now - this.context.getLastMessageTime() <
      advanced.rateLimits.cooldownBetweenMessages * 1000
    ) {
      return false;
    }

    return true;
  }

  private isBot(username: string): boolean {
    const botPatterns = ["bot", "nightbot", "streamlabs", "moobot", "fossabot"];
    return botPatterns.some((pattern) => username.toLowerCase().includes(pattern));
  }
}
