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
  conversationHistory: ModelMessage[];
  modelOptions?: ModelRequestOptions;
  isHeartbeat?: boolean;
  delegationDepth?: number;
  /**
   * How many judge-gated autonomous continuations have led to this run (§30.8).
   * Undefined/0 on the first autonomous wake; incremented per continuation and
   * bounded by AUTONOMOUS_MAX_TURNS. Carried on the goal (not thread state) so
   * the budget can't leak across independent heartbeat cycles.
   */
  autonomousTurn?: number;
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
