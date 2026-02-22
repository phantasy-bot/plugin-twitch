export interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler?: (args: unknown) => Promise<unknown>;
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  keywords?: string[];
  category?: string;
  tags?: string[];
  permissions?: string[];
  isPlatform?: boolean;
  platformFeatures?: Record<string, boolean>;
  configSchema?: Record<string, unknown>;
}

export interface PluginConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

export abstract class BasePlugin {
  abstract readonly name: string;
  abstract readonly version: string;
  
  getManifest(): PluginManifest {
    return {
      name: this.name,
      version: this.version,
      description: this.constructor.name,
    };
  }
  
  getTools(): PluginTool[] {
    return [];
  }
  
  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}
}
