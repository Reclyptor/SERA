import { Injectable, Logger } from '@nestjs/common';
import { StateStore } from './state.store';
import {
  ThreadState,
  RunState,
  AgentState,
  ToolCall,
  StateSnapshot,
} from './state.interface';

@Injectable()
export class StateService {
  private readonly logger = new Logger(StateService.name);

  constructor(private readonly store: StateStore) {}

  // Thread management

  async createThread(threadID?: string): Promise<ThreadState> {
    const id = threadID ?? crypto.randomUUID();
    return this.store.createThread(id);
  }

  async getThread(threadID: string): Promise<ThreadState | undefined> {
    return this.store.getThread(threadID);
  }

  async getOrCreateThread(threadID: string): Promise<ThreadState> {
    return this.store.getOrCreateThread(threadID);
  }

  async deleteThread(threadID: string): Promise<boolean> {
    this.logger.log(`Deleting thread: ${threadID}`);
    return this.store.deleteThread(threadID);
  }

  // Tool call management

  async recordToolCall(
    threadID: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCall> {
    return this.store.addToolCall(threadID, { name, args });
  }

  async markToolCallExecuting(
    threadID: string,
    toolCallID: string,
  ): Promise<ToolCall | undefined> {
    return this.store.updateToolCall(threadID, toolCallID, {
      status: 'executing',
    });
  }

  async markToolCallCompleted(
    threadID: string,
    toolCallID: string,
    result: unknown,
  ): Promise<ToolCall | undefined> {
    return this.store.updateToolCall(threadID, toolCallID, {
      status: 'completed',
      result,
    });
  }

  async markToolCallFailed(
    threadID: string,
    toolCallID: string,
    error: string,
  ): Promise<ToolCall | undefined> {
    return this.store.updateToolCall(threadID, toolCallID, {
      status: 'failed',
      result: { error },
    });
  }

  // Run management

  async startRun(threadID: string, runID?: string): Promise<RunState> {
    const id = runID ?? crypto.randomUUID();
    const run = await this.store.createRun(id, threadID);
    await this.store.updateRun(id, { status: 'running' });
    return run;
  }

  async completeRun(runID: string, response?: string): Promise<RunState | undefined> {
    return this.store.updateRun(runID, {
      status: 'completed',
      completedAt: new Date(),
      ...(response && { response }),
    });
  }

  async failRun(runID: string, error: string): Promise<RunState | undefined> {
    return this.store.updateRun(runID, {
      status: 'failed',
      completedAt: new Date(),
      error,
    });
  }

  async cancelRun(runID: string): Promise<RunState | undefined> {
    return this.store.updateRun(runID, {
      status: 'cancelled',
      completedAt: new Date(),
    });
  }

  // Agent state management

  async getAgentState(threadID: string): Promise<AgentState> {
    return this.store.getAgentState(threadID);
  }

  async setWorkflowStep(threadID: string, step: string): Promise<void> {
    await this.store.updateAgentState(threadID, { currentStep: step });
    this.logger.debug(`Thread ${threadID} workflow step: ${step}`);
  }

  async setCustomState<T>(
    threadID: string,
    key: string,
    value: T,
  ): Promise<void> {
    await this.store.setCustomState(threadID, key, value);
  }

  async getCustomState<T>(
    threadID: string,
    key: string,
  ): Promise<T | undefined> {
    return this.store.getCustomState<T>(threadID, key);
  }

  // Confirmations (human-in-the-loop)

  async addPendingConfirmation(
    threadID: string,
    actionName: string,
    args: Record<string, unknown>,
    message: string,
    runID?: string,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await this.store.addPendingConfirmation(threadID, {
      id,
      actionName,
      args,
      message,
      runID,
      status: 'pending',
      createdAt: new Date(),
    });
    this.logger.debug(
      `Added pending confirmation: ${id} for action: ${actionName}`,
    );
    return id;
  }

  async resolveConfirmation(
    threadID: string,
    confirmationID: string,
    decision: { approved: boolean; feedback?: string; resolvedBy?: string },
  ): Promise<boolean> {
    return this.store.resolveConfirmation(threadID, confirmationID, decision);
  }

  async getConfirmation(
    threadID: string,
    confirmationID: string,
  ): Promise<AgentState['pendingConfirmations'][0] | undefined> {
    return this.store.getConfirmation(threadID, confirmationID);
  }

  async removePendingConfirmation(
    threadID: string,
    confirmationID: string,
  ): Promise<boolean> {
    return this.store.removePendingConfirmation(threadID, confirmationID);
  }

  async getPendingConfirmations(
    threadID: string,
  ): Promise<AgentState['pendingConfirmations']> {
    const state = await this.store.getAgentState(threadID);
    return state.pendingConfirmations;
  }

  // Snapshot

  async getSnapshot(
    threadID: string,
    runID?: string,
  ): Promise<StateSnapshot | undefined> {
    return this.store.getSnapshot(threadID, runID);
  }
}
