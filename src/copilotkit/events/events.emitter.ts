import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import {
  AGUIEvent,
  CustomEvent,
  HITLEvent,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  StateSnapshotEvent,
  StateDeltaEvent,
  MessagesSnapshotEvent,
} from './interfaces/event.interface';

@Injectable()
export class EventsEmitter {
  private readonly logger = new Logger(EventsEmitter.name);

  /**
   * Send an SSE event to the response stream
   */
  emit(res: Response, event: AGUIEvent): void {
    const data = JSON.stringify(event);
    res.write(`data: ${data}\n\n`);
  }

  /**
   * Send a custom event (for HITL and app-specific needs)
   */
  emitCustom(res: Response, name: string, value: unknown): void {
    const event: CustomEvent = {
      type: 'CUSTOM',
      name,
      value,
    };
    this.emit(res, event);
  }

  /**
   * Send an HITL event wrapped as a custom event
   */
  emitHITL(res: Response, event: HITLEvent): void {
    this.emitCustom(res, event.name, event);
  }

  // Convenience methods for common events

  runStarted(res: Response, threadId: string, runId: string): void {
    const event: RunStartedEvent = {
      type: 'RUN_STARTED',
      threadId,
      runId,
    };
    this.emit(res, event);
  }

  runFinished(res: Response, threadId: string, runId: string): void {
    const event: RunFinishedEvent = {
      type: 'RUN_FINISHED',
      threadId,
      runId,
    };
    this.emit(res, event);
  }

  runError(res: Response, message: string): void {
    const event: RunErrorEvent = {
      type: 'RUN_ERROR',
      message,
    };
    this.emit(res, event);
  }

  textMessageStart(res: Response, messageId: string): void {
    const event: TextMessageStartEvent = {
      type: 'TEXT_MESSAGE_START',
      messageId,
      role: 'assistant',
    };
    this.emit(res, event);
  }

  textMessageContent(res: Response, messageId: string, delta: string): void {
    const event: TextMessageContentEvent = {
      type: 'TEXT_MESSAGE_CONTENT',
      messageId,
      delta,
    };
    this.emit(res, event);
  }

  textMessageEnd(res: Response, messageId: string): void {
    const event: TextMessageEndEvent = {
      type: 'TEXT_MESSAGE_END',
      messageId,
    };
    this.emit(res, event);
  }

  toolCallStart(res: Response, toolCallId: string, toolCallName: string): void {
    const event: ToolCallStartEvent = {
      type: 'TOOL_CALL_START',
      toolCallId,
      toolCallName,
    };
    this.emit(res, event);
  }

  toolCallArgs(res: Response, toolCallId: string, delta: string): void {
    const event: ToolCallArgsEvent = {
      type: 'TOOL_CALL_ARGS',
      toolCallId,
      delta,
    };
    this.emit(res, event);
  }

  toolCallEnd(res: Response, toolCallId: string, result?: string): void {
    const event: ToolCallEndEvent = {
      type: 'TOOL_CALL_END',
      toolCallId,
      result,
    };
    this.emit(res, event);
  }

  stateSnapshot(res: Response, snapshot: Record<string, unknown>): void {
    const event: StateSnapshotEvent = {
      type: 'STATE_SNAPSHOT',
      snapshot,
    };
    this.emit(res, event);
  }

  stateDelta(
    res: Response,
    delta: Array<{ op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }>,
  ): void {
    const event: StateDeltaEvent = {
      type: 'STATE_DELTA',
      delta,
    };
    this.emit(res, event);
  }

  messagesSnapshot(
    res: Response,
    messages: Array<{ id: string; role: 'user' | 'assistant' | 'system'; content: string }>,
  ): void {
    const event: MessagesSnapshotEvent = {
      type: 'MESSAGES_SNAPSHOT',
      messages,
    };
    this.emit(res, event);
  }

  // HITL convenience methods

  requestConfirmation(
    res: Response,
    confirmationId: string,
    actionName: string,
    args: Record<string, unknown>,
    message: string,
  ): void {
    this.emitHITL(res, {
      name: 'confirmation_request',
      confirmationId,
      actionName,
      args,
      message,
    });
  }

  progressUpdate(res: Response, step: string, progress: number, message?: string): void {
    this.emitHITL(res, {
      name: 'progress_update',
      step,
      progress,
      message,
    });
  }

  // Thinking convenience methods (extended thinking / Claude)

  thinkingStart(res: Response, thinkingId: string): void {
    this.emitHITL(res, {
      name: 'thinking_start',
      thinkingId,
    });
  }

  thinkingContent(res: Response, thinkingId: string, delta: string): void {
    this.emitHITL(res, {
      name: 'thinking_content',
      thinkingId,
      delta,
    });
  }

  thinkingEnd(res: Response, thinkingId: string): void {
    this.emitHITL(res, {
      name: 'thinking_end',
      thinkingId,
    });
  }
}
