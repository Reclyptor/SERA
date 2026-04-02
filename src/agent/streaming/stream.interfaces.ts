import type { AgentPlan, AgentStep } from '../orchestration/orchestration.interfaces';

export type AgentEventType =
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'thinking.delta'
  | 'thinking.done'
  | 'text.delta'
  | 'text.done'
  | 'tool_call.started'
  | 'tool_call.executing'
  | 'tool_call.result'
  | 'tool_call.error'
  | 'plan.created'
  | 'plan.step_updated'
  | 'evaluation.done'
  | 'confirmation.required'
  | 'confirmation.resolved'
  | 'error';

export interface AgentEvent {
  type: AgentEventType;
  runId: string;
  threadId: string;
  timestamp: number;
  data: unknown;
}

// Event data shapes

export interface RunStartedData {
  provider: string;
  modelId: string;
}

export interface RunCompletedData {
  response: string;
}

export interface RunFailedData {
  error: string;
}

export interface ThinkingDeltaData {
  content: string;
}

export interface ThinkingDoneData {
  content: string;
}

export interface TextDeltaData {
  content: string;
}

export interface TextDoneData {
  content: string;
}

export interface ToolCallStartedData {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolCallResultData {
  toolCallId: string;
  toolName: string;
  result: unknown;
  success: boolean;
}

export interface ToolCallErrorData {
  toolCallId: string;
  toolName: string;
  error: string;
}

export interface PlanCreatedData {
  plan: AgentPlan;
}

export interface PlanStepUpdatedData {
  step: AgentStep;
  stepIndex: number;
  totalSteps: number;
}

export interface EvaluationDoneData {
  goalAchieved: boolean;
  reasoning: string;
  nextAction: string;
}

export interface ConfirmationRequiredData {
  confirmationId: string;
  actionName: string;
  args: Record<string, unknown>;
  message: string;
}

export interface ConfirmationResolvedData {
  confirmationId: string;
  approved: boolean;
}

export interface ErrorData {
  error: string;
  recoverable: boolean;
}
