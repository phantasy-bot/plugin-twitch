import { BasePlugin, type PluginTool } from "@phantasy/agent/plugins";

export class TwitchPlugin extends BasePlugin {
  name = "twitch";
  version = "2.0.0";
  description = "Twitch streaming and chat integration plugin for Phantasy companions.";

  protected displayName = "Twitch";
  protected category = "streaming";
  protected tags = ["twitch","streaming","chat","creator"];
  protected permissions = ["internet"];
  protected workspace = "business" as const;
  protected extensionKind = "integration" as const;
  protected adminSurface =   {
    "tabId": "twitch",
    "label": "Twitch",
    "section": "business",
    "workspace": "business",
    "kind": "generic",
    "keywords": [
      "twitch",
      "streaming",
      "chat",
      "creator"
    ]
  } as const;
  protected configSchema =   {
    "type": "object",
    "properties": {
      "enabled": {
        "type": "boolean",
        "default": true
      }
    }
  };

  getTools(): PluginTool[] {
    return [];
  }
}

export default TwitchPlugin;
