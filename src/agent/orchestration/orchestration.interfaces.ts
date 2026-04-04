import type { CoreMessage } from 'ai';
import type { ModelRequestOptions } from '../model/model.interfaces';

export type AgentPhase =
  | 'planning'
  | 'executing'
  | 'evaluating'
  | 'completed'
  | 'failed'
  | 'awaiting_confirmation';

export interface AgentGoal {
  threadId: string;
  runId: string;
  userId: string;
  userMessage: string;
  conversationHistory: CoreMessage[];
  modelOptions?: ModelRequestOptions;
}

export interface AgentPlan {
  goal: string;
  reasoning: string;
  steps: AgentStep[];
}

export interface AgentStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
}

export interface AgentEvaluation {
  goalAchieved: boolean;
  reasoning: string;
  nextAction: 'complete' | 'continue' | 'replan' | 'ask_user';
  response?: string;
  followUpQuestion?: string;
}

export interface OrchestratorConfig {
  /** Max tool-calling steps per execution loop (default: 15) */
  maxSteps: number;
  /** Max replan attempts (default: 3) */
  maxReplans: number;
  /** Max outer loop iterations to prevent runaway "continue" cycles (default: 5) */
  maxIterations: number;
  /** Whether to generate an explicit plan before executing (default: false) */
  planningEnabled: boolean;
  /** Whether to self-evaluate after execution (default: false) */
  evaluationEnabled: boolean;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxSteps: 15,
  maxReplans: 3,
  maxIterations: 5,
  planningEnabled: false,
  evaluationEnabled: false,
};
