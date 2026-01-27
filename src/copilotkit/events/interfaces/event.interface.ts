/**
 * AG-UI Protocol Event Types
 * https://docs.copilotkit.ai/coagents/advanced/ag-ui-protocol
 */
export type AGUIEventType =
  | 'RUN_STARTED'
  | 'RUN_FINISHED'
  | 'RUN_ERROR'
  | 'TEXT_MESSAGE_START'
  | 'TEXT_MESSAGE_CONTENT'
  | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_ARGS'
  | 'TOOL_CALL_END'
  | 'STATE_SNAPSHOT'
  | 'STATE_DELTA'
  | 'MESSAGES_SNAPSHOT'
  | 'CUSTOM';

export interface BaseEvent {
  type: AGUIEventType;
  timestamp?: Date;
}

export interface RunStartedEvent extends BaseEvent {
  type: 'RUN_STARTED';
  threadId: string;
  runId: string;
}

export interface RunFinishedEvent extends BaseEvent {
  type: 'RUN_FINISHED';
  threadId: string;
  runId: string;
}

export interface RunErrorEvent extends BaseEvent {
  type: 'RUN_ERROR';
  message: string;
}

export interface TextMessageStartEvent extends BaseEvent {
  type: 'TEXT_MESSAGE_START';
  messageId: string;
  role: 'assistant';
}

export interface TextMessageContentEvent extends BaseEvent {
  type: 'TEXT_MESSAGE_CONTENT';
  messageId: string;
  delta: string;
}

export interface TextMessageEndEvent extends BaseEvent {
  type: 'TEXT_MESSAGE_END';
  messageId: string;
}

export interface ToolCallStartEvent extends BaseEvent {
  type: 'TOOL_CALL_START';
  toolCallId: string;
  toolCallName: string;
}

export interface ToolCallArgsEvent extends BaseEvent {
  type: 'TOOL_CALL_ARGS';
  toolCallId: string;
  delta: string;
}

export interface ToolCallEndEvent extends BaseEvent {
  type: 'TOOL_CALL_END';
  toolCallId: string;
  result?: string;
}

export interface StateSnapshotEvent extends BaseEvent {
  type: 'STATE_SNAPSHOT';
  snapshot: Record<string, unknown>;
}

export interface StateDeltaEvent extends BaseEvent {
  type: 'STATE_DELTA';
  delta: Array<{
    op: 'add' | 'remove' | 'replace';
    path: string;
    value?: unknown;
  }>;
}

export interface MessagesSnapshotEvent extends BaseEvent {
  type: 'MESSAGES_SNAPSHOT';
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
}

/**
 * Custom events for human-in-the-loop and application-specific needs
 */
export interface CustomEvent extends BaseEvent {
  type: 'CUSTOM';
  name: string;
  value: unknown;
}

export type AGUIEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | StateSnapshotEvent
  | StateDeltaEvent
  | MessagesSnapshotEvent
  | CustomEvent;

/**
 * Human-in-the-loop specific events
 */
export interface ConfirmationRequestEvent {
  name: 'confirmation_request';
  confirmationId: string;
  actionName: string;
  args: Record<string, unknown>;
  message: string;
}

export interface ConfirmationResponseEvent {
  name: 'confirmation_response';
  confirmationId: string;
  confirmed: boolean;
}

export interface ProgressUpdateEvent {
  name: 'progress_update';
  step: string;
  progress: number;
  message?: string;
}

/**
 * Thinking events for extended thinking (Claude)
 */
export interface ThinkingStartEvent {
  name: 'thinking_start';
  thinkingId: string;
}

export interface ThinkingContentEvent {
  name: 'thinking_content';
  thinkingId: string;
  delta: string;
}

export interface ThinkingEndEvent {
  name: 'thinking_end';
  thinkingId: string;
}

export type ThinkingEvent =
  | ThinkingStartEvent
  | ThinkingContentEvent
  | ThinkingEndEvent;

export type HITLEvent =
  | ConfirmationRequestEvent
  | ConfirmationResponseEvent
  | ProgressUpdateEvent
  | ThinkingEvent;
