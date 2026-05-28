import type { ModelMessage, StreamTextResult, ToolSet } from 'ai';
import type { ModelRequestOptions } from '../model/model.interfaces';

export interface AgentRuntimeAttempt {
  attempt: number;
  provider: string;
  modelID: string;
}

export interface AgentRuntimeFallback extends AgentRuntimeAttempt {
  reason: string;
  message: string;
  nextProvider?: string;
  nextModelID?: string;
}

export interface AgentRuntimeStreamInput {
  messages: ModelMessage[];
  tools?: ToolSet;
  system?: string;
  stopSteps?: number;
  maxOutputTokens?: number;
  temperature?: number;
  options?: ModelRequestOptions;
  abortSignal?: AbortSignal;
  onAttempt?: (attempt: AgentRuntimeAttempt) => void | Promise<void>;
  onFallback?: (fallback: AgentRuntimeFallback) => void | Promise<void>;
}

export interface AgentRuntime {
  streamAttempt(
    input: AgentRuntimeStreamInput,
  ): StreamTextResult<ToolSet, never>;
}
