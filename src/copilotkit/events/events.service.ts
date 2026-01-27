import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { EventsEmitter } from './events.emitter';
import { StateService } from '../state';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly emitter: EventsEmitter,
    private readonly stateService: StateService,
  ) {}

  /**
   * Initialize SSE response headers
   */
  initSSE(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }

  /**
   * Start a new run and emit the RUN_STARTED event
   */
  startRun(res: Response, threadId: string, runId: string): void {
    this.stateService.startRun(threadId, runId);
    this.emitter.runStarted(res, threadId, runId);
    this.logger.debug(`Run started: ${runId} for thread: ${threadId}`);
  }

  /**
   * Complete a run and emit the RUN_FINISHED event
   */
  finishRun(res: Response, threadId: string, runId: string): void {
    this.stateService.completeRun(runId);
    this.emitter.runFinished(res, threadId, runId);
    this.logger.debug(`Run finished: ${runId}`);
  }

  /**
   * Fail a run and emit the RUN_ERROR event
   */
  failRun(res: Response, runId: string, error: string): void {
    this.stateService.failRun(runId, error);
    this.emitter.runError(res, error);
    this.logger.error(`Run failed: ${runId} - ${error}`);
  }

  /**
   * Start streaming a text message
   */
  startTextMessage(res: Response, messageId: string): void {
    this.emitter.textMessageStart(res, messageId);
  }

  /**
   * Stream text content
   */
  streamTextContent(res: Response, messageId: string, content: string): void {
    this.emitter.textMessageContent(res, messageId, content);
  }

  /**
   * End a text message
   */
  endTextMessage(res: Response, messageId: string): void {
    this.emitter.textMessageEnd(res, messageId);
  }

  /**
   * Start a tool call
   */
  startToolCall(res: Response, threadId: string, toolCallId: string, toolName: string): void {
    this.stateService.recordToolCall(threadId, toolName, {});
    this.emitter.toolCallStart(res, toolCallId, toolName);
    this.logger.debug(`Tool call started: ${toolName} (${toolCallId})`);
  }

  /**
   * Stream tool call arguments
   */
  streamToolCallArgs(res: Response, toolCallId: string, args: string): void {
    this.emitter.toolCallArgs(res, toolCallId, args);
  }

  /**
   * End a tool call with result
   */
  endToolCall(res: Response, threadId: string, toolCallId: string, result?: unknown): void {
    const resultStr = result !== undefined ? JSON.stringify(result) : undefined;
    this.emitter.toolCallEnd(res, toolCallId, resultStr);
    this.logger.debug(`Tool call ended: ${toolCallId}`);
  }

  /**
   * Request human confirmation for an action
   */
  requestConfirmation(
    res: Response,
    threadId: string,
    actionName: string,
    args: Record<string, unknown>,
    message: string,
  ): string {
    const confirmationId = this.stateService.addPendingConfirmation(
      threadId,
      actionName,
      args,
      message,
    );
    this.emitter.requestConfirmation(res, confirmationId, actionName, args, message);
    this.logger.debug(`Confirmation requested: ${confirmationId} for action: ${actionName}`);
    return confirmationId;
  }

  /**
   * Send a progress update for long-running operations
   */
  sendProgressUpdate(res: Response, step: string, progress: number, message?: string): void {
    this.emitter.progressUpdate(res, step, progress, message);
  }

  /**
   * Send current state snapshot
   */
  sendStateSnapshot(res: Response, threadId: string): void {
    const state = this.stateService.getAgentState(threadId);
    this.emitter.stateSnapshot(res, state.custom);
  }

  /**
   * Send state delta update
   */
  sendStateDelta(
    res: Response,
    delta: Array<{ op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }>,
  ): void {
    this.emitter.stateDelta(res, delta);
  }
}
