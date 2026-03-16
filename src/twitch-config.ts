export interface TwitchCommand {
  id: string;
  name: string;
  trigger: string;
  response: string;
  cooldown?: number; // seconds
  modOnly?: boolean;
  subOnly?: boolean;
  enabled: boolean;
}

export interface TwitchModerationConfig {
  enableAutomod: boolean;
  filterProfanity: boolean;
  filterSpam: boolean;
  filterCaps: boolean;
  maxCapsPercentage: number;
  maxMessageLength: number;
  slowModeSeconds?: number;
  followersOnlyMinutes?: number;
  blacklistedWords: string[];
  whitelistedUsers: string[];
}

export interface TwitchAdvancedConfig {
  // Chat response settings
  chatResponse: {
    enabled: boolean;
    respondToMentions: boolean;
    respondToCommands: boolean;
    respondToKeywords: boolean;
    keywords?: string[];
    responseDelay: number; // seconds
    requireFollower: boolean;
    requireSubscriber: boolean;
    ignoreBots: boolean;
  };

  // Custom commands
  commands: TwitchCommand[];

  // Moderation settings
  moderation: TwitchModerationConfig;

  // Engagement settings
  engagement: {
    welcomeNewFollowers: boolean;
    welcomeNewSubscribers: boolean;
    thankDonations: boolean;
    announceGoals: boolean;
    hostRaids: boolean;
  };

  // Rate limiting
  rateLimits: {
    maxMessagesPerMinute: number;
    maxCommandsPerMinute: number;
    cooldownBetweenMessages: number; // seconds
  };

  // Analytics
  analytics: {
    trackChatActivity: boolean;
    trackViewerGrowth: boolean;
    trackEngagementMetrics: boolean;
  };
}

export interface TwitchStreamStatus {
  gameName?: string | null;
  live: boolean;
  title?: string | null;
  url?: string;
  viewerCount?: number;
}

export const defaultTwitchAdvancedConfig: TwitchAdvancedConfig = {
  chatResponse: {
    enabled: true,
    respondToMentions: true,
    respondToCommands: true,
    respondToKeywords: false,
    keywords: [],
    responseDelay: 2, // 2 second delay before responding
    requireFollower: false,
    requireSubscriber: false,
    ignoreBots: true,
  },
  commands: [
    {
      id: "help",
      name: "Help Command",
      trigger: "!help",
      response:
        "Available commands: !help, !about, !socials. I'm an AI assistant here to chat!",
      cooldown: 10,
      modOnly: false,
      subOnly: false,
      enabled: true,
    },
    {
      id: "about",
      name: "About Command",
      trigger: "!about",
      response:
        "I'm an AI agent powered by Phantasy. Ask me anything or just chat. 🤖",
      cooldown: 15,
      modOnly: false,
      subOnly: false,
      enabled: true,
    },
    {
      id: "socials",
      name: "Social Links",
      trigger: "!socials",
      response:
        "Follow us on Twitter and join our Discord! Links in the about section.",
      cooldown: 30,
      modOnly: false,
      subOnly: false,
      enabled: true,
    },
  ],
  moderation: {
    enableAutomod: true,
    filterProfanity: true,
    filterSpam: true,
    filterCaps: true,
    maxCapsPercentage: 70,
    maxMessageLength: 500,
    blacklistedWords: [],
    whitelistedUsers: [],
  },
  engagement: {
    welcomeNewFollowers: true,
    welcomeNewSubscribers: true,
    thankDonations: true,
    announceGoals: false,
    hostRaids: true,
  },
  rateLimits: {
    maxMessagesPerMinute: 10, // Conservative limit
    maxCommandsPerMinute: 5, // Even more conservative for commands
    cooldownBetweenMessages: 3, // 3 seconds between any messages
  },
  analytics: {
    trackChatActivity: true,
    trackViewerGrowth: true,
    trackEngagementMetrics: true,
  },
};
