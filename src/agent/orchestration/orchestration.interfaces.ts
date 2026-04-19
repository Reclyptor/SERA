import type { CoreMessage } from 'ai';
import type { ModelRequestOptions } from '../model/model.interfaces';

export interface AgentGoal {
  threadID: string;
  runID: string;
  userID: string;
  chatID?: string;
  agentID: string;
  userMessage: string;
  conversationHistory: CoreMessage[];
  modelOptions?: ModelRequestOptions;
  isHeartbeat?: boolean;
  delegationDepth?: number;
}

export interface OrchestratorConfig {
  /** Max tool-calling steps per streaming session (default: 15) */
  maxSteps: number;
  /** Max outer loop iterations — each iteration is a full streaming session (default: 5) */
  maxIterations: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxSteps: 15,
  maxIterations: 5,
};
