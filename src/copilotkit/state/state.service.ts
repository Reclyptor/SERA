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

  async createThread(threadId?: string): Promise<ThreadState> {
    const id = threadId ?? crypto.randomUUID();
    return this.store.createThread(id);
  }

  async getThread(threadId: string): Promise<ThreadState | undefined> {
    return this.store.getThread(threadId);
  }

  async getOrCreateThread(threadId: string): Promise<ThreadState> {
    return this.store.getOrCreateThread(threadId);
  }

  async deleteThread(threadId: string): Promise<boolean> {
    this.logger.log(`Deleting thread: ${threadId}`);
    return this.store.deleteThread(threadId);
  }

  // Message management

  async addUserMessage(threadId: string, content: string): Promise<Message> {
    return this.store.addMessage(threadId, { role: 'user', content });
  }

  async addAssistantMessage(threadId: string, content: string): Promise<Message> {
    return this.store.addMessage(threadId, { role: 'assistant', content });
  }

  async addSystemMessage(threadId: string, content: string): Promise<Message> {
    return this.store.addMessage(threadId, { role: 'system', content });
  }

  async getMessages(threadId: string): Promise<Message[]> {
    return this.store.getMessages(threadId);
  }

  // Tool call management

  async recordToolCall(threadId: string, name: string, args: Record<string, unknown>): Promise<ToolCall> {
    return this.store.addToolCall(threadId, { name, args });
  }

  async markToolCallExecuting(threadId: string, toolCallId: string): Promise<ToolCall | undefined> {
    return this.store.updateToolCall(threadId, toolCallId, { status: 'executing' });
  }

  async markToolCallCompleted(threadId: string, toolCallId: string, result: unknown): Promise<ToolCall | undefined> {
    return this.store.updateToolCall(threadId, toolCallId, {
      status: 'completed',
      result,
    });
  }

  async markToolCallFailed(threadId: string, toolCallId: string, error: string): Promise<ToolCall | undefined> {
    return this.store.updateToolCall(threadId, toolCallId, {
      status: 'failed',
      result: { error },
    });
  }

  // Run management

  async startRun(threadId: string, runId?: string): Promise<RunState> {
    const id = runId ?? crypto.randomUUID();
    const run = await this.store.createRun(id, threadId);
    await this.store.updateRun(id, { status: 'running' });
    return run;
  }

  async completeRun(runId: string): Promise<RunState | undefined> {
    return this.store.updateRun(runId, {
      status: 'completed',
      completedAt: new Date(),
    });
  }

  async failRun(runId: string, error: string): Promise<RunState | undefined> {
    return this.store.updateRun(runId, {
      status: 'failed',
      completedAt: new Date(),
      error,
    });
  }

  async cancelRun(runId: string): Promise<RunState | undefined> {
    return this.store.updateRun(runId, {
      status: 'cancelled',
      completedAt: new Date(),
    });
  }

  // Agent state management

  async getAgentState(threadId: string): Promise<AgentState> {
    return this.store.getAgentState(threadId);
  }

  async setWorkflowStep(threadId: string, step: string): Promise<void> {
    await this.store.updateAgentState(threadId, { currentStep: step });
    this.logger.debug(`Thread ${threadId} workflow step: ${step}`);
  }

  async setCustomState<T>(threadId: string, key: string, value: T): Promise<void> {
    await this.store.setCustomState(threadId, key, value);
  }

  async getCustomState<T>(threadId: string, key: string): Promise<T | undefined> {
    return this.store.getCustomState<T>(threadId, key);
  }

  // Confirmations (human-in-the-loop)

  async addPendingConfirmation(
    threadId: string,
    actionName: string,
    args: Record<string, unknown>,
    message: string,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await this.store.addPendingConfirmation(threadId, {
      id,
      actionName,
      args,
      message,
      createdAt: new Date(),
    });
    this.logger.debug(`Added pending confirmation: ${id} for action: ${actionName}`);
    return id;
  }

  async resolvePendingConfirmation(threadId: string, confirmationId: string): Promise<boolean> {
    return this.store.removePendingConfirmation(threadId, confirmationId);
  }

  async getPendingConfirmations(threadId: string): Promise<AgentState['pendingConfirmations']> {
    const state = await this.store.getAgentState(threadId);
    return state.pendingConfirmations;
  }

  // Snapshot

  async getSnapshot(threadId: string, runId?: string): Promise<StateSnapshot | undefined> {
    return this.store.getSnapshot(threadId, runId);
  }
}
