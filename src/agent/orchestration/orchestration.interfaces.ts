import type { ModelMessage } from 'ai';
import type { ModelRequestOptions } from '../model/model.interfaces';

export interface AgentGoal {
  threadID: string;
  runID: string;
  userID: string;
  userName?: string;
  chatID?: string;
  agentID: string;
  userMessage: string;
  attachmentIDs?: string[];
  conversationHistory: ModelMessage[];
  modelOptions?: ModelRequestOptions;
  isHeartbeat?: boolean;
  delegationDepth?: number;
}

export interface OrchestratorConfig {
  maxSteps: number;
  maxIterations: number;
  wallClockTimeoutMs: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxSteps: 15,
  maxIterations: 5,
  wallClockTimeoutMs: 0,
};

export const AUTONOMOUS_RUN_CONFIG: OrchestratorConfig = {
  maxSteps: 10,
  maxIterations: 2,
  wallClockTimeoutMs: 180_000,
};
