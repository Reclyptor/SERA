import type { Tool } from '../tools/tool.interface';

export interface PluginContext {
  registerTool(tool: Tool): void;
  registerKnowledge(key: string, content: string): void;
  getConfig<T = unknown>(key: string): T | undefined;
  logger: {
    log(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
  };
}

export interface PluginConfig {
  name: string;
  packageName: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  version?: string;
}

export interface SeraPlugin {
  name: string;
  version: string;
  description?: string;
  onRegister(context: PluginContext): Promise<void> | void;
  onUnregister?(): Promise<void> | void;
}
