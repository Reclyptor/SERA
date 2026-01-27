import { Injectable, Logger } from '@nestjs/common';
import { StateStore } from './state.store';
import {
  ThreadState,
  RunState,
  AgentState,
  Message,
  ToolCall,
  StateSnapshot,
} from './interfaces/state.interface';

@Injectable()
export class StateService {
  private readonly logger = new Logger(StateService.name);

  constructor(private readonly store: StateStore) {}

  // Thread management

  createThread(threadId?: string): ThreadState {
    const id = threadId ?? crypto.randomUUID();
    return this.store.createThread(id);
  }

  getThread(threadId: string): ThreadState | undefined {
    return this.store.getThread(threadId);
  }

  getOrCreateThread(threadId: string): ThreadState {
    return this.store.getOrCreateThread(threadId);
  }

  deleteThread(threadId: string): boolean {
    this.logger.log(`Deleting thread: ${threadId}`);
    return this.store.deleteThread(threadId);
  }

  // Message management

  addUserMessage(threadId: string, content: string): Message {
    return this.store.addMessage(threadId, { role: 'user', content });
  }

  addAssistantMessage(threadId: string, content: string): Message {
    return this.store.addMessage(threadId, { role: 'assistant', content });
  }

  addSystemMessage(threadId: string, content: string): Message {
    return this.store.addMessage(threadId, { role: 'system', content });
  }

  getMessages(threadId: string): Message[] {
    return this.store.getMessages(threadId);
  }

  // Tool call management

  recordToolCall(threadId: string, name: string, args: Record<string, unknown>): ToolCall {
    return this.store.addToolCall(threadId, { name, args });
  }

  markToolCallExecuting(threadId: string, toolCallId: string): ToolCall | undefined {
    return this.store.updateToolCall(threadId, toolCallId, { status: 'executing' });
  }

  markToolCallCompleted(threadId: string, toolCallId: string, result: unknown): ToolCall | undefined {
    return this.store.updateToolCall(threadId, toolCallId, {
      status: 'completed',
      result,
    });
  }

  markToolCallFailed(threadId: string, toolCallId: string, error: string): ToolCall | undefined {
    return this.store.updateToolCall(threadId, toolCallId, {
      status: 'failed',
      result: { error },
    });
  }

  // Run management

  startRun(threadId: string, runId?: string): RunState {
    const id = runId ?? crypto.randomUUID();
    const run = this.store.createRun(id, threadId);
    this.store.updateRun(id, { status: 'running' });
    return run;
  }

  completeRun(runId: string): RunState | undefined {
    return this.store.updateRun(runId, {
      status: 'completed',
      completedAt: new Date(),
    });
  }

  failRun(runId: string, error: string): RunState | undefined {
    return this.store.updateRun(runId, {
      status: 'failed',
      completedAt: new Date(),
      error,
    });
  }

  cancelRun(runId: string): RunState | undefined {
    return this.store.updateRun(runId, {
      status: 'cancelled',
      completedAt: new Date(),
    });
  }

  // Agent state management

  getAgentState(threadId: string): AgentState {
    return this.store.getAgentState(threadId);
  }

  setWorkflowStep(threadId: string, step: string): void {
    const state = this.store.getAgentState(threadId);
    state.currentStep = step;
    this.logger.debug(`Thread ${threadId} workflow step: ${step}`);
  }

  setCustomState<T>(threadId: string, key: string, value: T): void {
    this.store.setCustomState(threadId, key, value);
  }

  getCustomState<T>(threadId: string, key: string): T | undefined {
    return this.store.getCustomState<T>(threadId, key);
  }

  // Confirmations (human-in-the-loop)

  addPendingConfirmation(
    threadId: string,
    actionName: string,
    args: Record<string, unknown>,
    message: string,
  ): string {
    const state = this.store.getAgentState(threadId);
    const id = crypto.randomUUID();
    state.pendingConfirmations.push({
      id,
      actionName,
      args,
      message,
      createdAt: new Date(),
    });
    this.logger.debug(`Added pending confirmation: ${id} for action: ${actionName}`);
    return id;
  }

  resolvePendingConfirmation(threadId: string, confirmationId: string): boolean {
    const state = this.store.getAgentState(threadId);
    const index = state.pendingConfirmations.findIndex((c) => c.id === confirmationId);
    if (index === -1) return false;
    state.pendingConfirmations.splice(index, 1);
    return true;
  }

  getPendingConfirmations(threadId: string) {
    return this.store.getAgentState(threadId).pendingConfirmations;
  }

  // Snapshot

  getSnapshot(threadId: string, runId?: string): StateSnapshot | undefined {
    return this.store.getSnapshot(threadId, runId);
  }
}
