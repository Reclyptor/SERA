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
  | 'confirmation.required'
  | 'confirmation.resolved'
  | 'error';

export interface AgentEvent {
  type: AgentEventType;
  runID: string;
  threadID: string;
  timestamp: number;
  data: unknown;
}

export interface RunStartedData {
  provider: string;
  modelID: string;
  chatID?: string;
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
  toolCallID: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolCallResultData {
  toolCallID: string;
  toolName: string;
  result: unknown;
  success: boolean;
}

export interface ToolCallErrorData {
  toolCallID: string;
  toolName: string;
  error: string;
}

export interface ConfirmationRequiredData {
  confirmationID: string;
  actionName: string;
  args: Record<string, unknown>;
  message: string;
}

export interface ConfirmationResolvedData {
  confirmationID: string;
  approved: boolean;
}

export interface ErrorData {
  error: string;
  recoverable: boolean;
}
