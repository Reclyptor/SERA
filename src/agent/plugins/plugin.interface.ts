import type { Tool } from '../tools/tool.interface';

export interface PluginCapabilities {
  [key: string]: unknown;
  tools?: string[];
  permissions?: Array<
    | 'tools.register'
    | 'knowledge.register'
    | 'hooks.llm'
    | 'hooks.tools'
    | 'network'
    | 'filesystem'
  >;
  requiresApproval?: boolean;
}

export interface PreToolCallHookArgs {
  toolName: string;
  args: Record<string, unknown>;
  threadID: string;
  runID: string;
}

export interface PostToolCallHookArgs extends PreToolCallHookArgs {
  result: unknown;
  success: boolean;
  durationMs: number;
}

export interface PreLLMCallHookArgs {
  threadID: string;
  runID: string;
  provider: string;
  modelID: string;
  messageCount: number;
}

export interface PostLLMCallHookArgs extends PreLLMCallHookArgs {
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
  durationMs: number;
}

export interface SessionHookArgs {
  threadID: string;
  runID: string;
  agentID: string;
  userID: string;
}

export type PluginHookFn<T> = (args: T) => Promise<void> | void;

export interface PluginContext {
  registerTool(tool: Tool): void;
  registerKnowledge(key: string, content: string): void;
  getConfig<T = unknown>(key: string): T | undefined;
  onPreToolCall(fn: PluginHookFn<PreToolCallHookArgs>): void;
  onPostToolCall(fn: PluginHookFn<PostToolCallHookArgs>): void;
  onPreLLMCall(fn: PluginHookFn<PreLLMCallHookArgs>): void;
  onPostLLMCall(fn: PluginHookFn<PostLLMCallHookArgs>): void;
  onSessionStart(fn: PluginHookFn<SessionHookArgs>): void;
  onSessionEnd(fn: PluginHookFn<SessionHookArgs>): void;
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
  capabilities?: PluginCapabilities;
}

export interface SeraPlugin {
  name: string;
  version: string;
  description?: string;
  capabilities?: PluginCapabilities;
  onRegister(context: PluginContext): Promise<void> | void;
  onUnregister?(): Promise<void> | void;
}
