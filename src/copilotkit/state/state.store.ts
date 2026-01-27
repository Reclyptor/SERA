import { Injectable, Logger } from '@nestjs/common';
import {
  ThreadState,
  RunState,
  AgentState,
  Message,
  ToolCall,
  StateSnapshot,
} from './interfaces/state.interface';

/**
 * In-memory state store
 * TODO: Replace with persistent storage (Redis, PostgreSQL, etc.)
 */
@Injectable()
export class StateStore {
  private readonly logger = new Logger(StateStore.name);
  private readonly threads = new Map<string, ThreadState>();
  private readonly runs = new Map<string, RunState>();
  private readonly agentStates = new Map<string, AgentState>();

  // Thread operations

  createThread(threadId: string): ThreadState {
    const thread: ThreadState = {
      threadId,
      messages: [],
      toolCalls: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.threads.set(threadId, thread);
    this.logger.debug(`Created thread: ${threadId}`);
    return thread;
  }

  getThread(threadId: string): ThreadState | undefined {
    return this.threads.get(threadId);
  }

  getOrCreateThread(threadId: string): ThreadState {
    return this.getThread(threadId) ?? this.createThread(threadId);
  }

  deleteThread(threadId: string): boolean {
    this.agentStates.delete(threadId);
    return this.threads.delete(threadId);
  }

  // Message operations

  addMessage(threadId: string, message: Omit<Message, 'id' | 'timestamp'>): Message {
    const thread = this.getOrCreateThread(threadId);
    const fullMessage: Message = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };
    thread.messages.push(fullMessage);
    thread.updatedAt = new Date();
    return fullMessage;
  }

  getMessages(threadId: string): Message[] {
    return this.getThread(threadId)?.messages ?? [];
  }

  // Tool call operations

  addToolCall(threadId: string, toolCall: Omit<ToolCall, 'id' | 'timestamp' | 'status'>): ToolCall {
    const thread = this.getOrCreateThread(threadId);
    const fullToolCall: ToolCall = {
      ...toolCall,
      id: crypto.randomUUID(),
      status: 'pending',
      timestamp: new Date(),
    };
    thread.toolCalls.push(fullToolCall);
    thread.updatedAt = new Date();
    return fullToolCall;
  }

  updateToolCall(
    threadId: string,
    toolCallId: string,
    update: Partial<Pick<ToolCall, 'status' | 'result'>>,
  ): ToolCall | undefined {
    const thread = this.getThread(threadId);
    if (!thread) return undefined;

    const toolCall = thread.toolCalls.find((tc) => tc.id === toolCallId);
    if (!toolCall) return undefined;

    Object.assign(toolCall, update);
    thread.updatedAt = new Date();
    return toolCall;
  }

  // Run operations

  createRun(runId: string, threadId: string): RunState {
    const run: RunState = {
      runId,
      threadId,
      status: 'pending',
      startedAt: new Date(),
    };
    this.runs.set(runId, run);
    this.logger.debug(`Created run: ${runId} for thread: ${threadId}`);
    return run;
  }

  getRun(runId: string): RunState | undefined {
    return this.runs.get(runId);
  }

  updateRun(runId: string, update: Partial<Pick<RunState, 'status' | 'completedAt' | 'error'>>): RunState | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;

    Object.assign(run, update);
    return run;
  }

  // Agent state operations

  getAgentState(threadId: string): AgentState {
    let state = this.agentStates.get(threadId);
    if (!state) {
      state = {
        custom: {},
        pendingConfirmations: [],
      };
      this.agentStates.set(threadId, state);
    }
    return state;
  }

  updateAgentState(threadId: string, update: Partial<AgentState>): AgentState {
    const state = this.getAgentState(threadId);
    Object.assign(state, update);
    return state;
  }

  setCustomState(threadId: string, key: string, value: unknown): void {
    const state = this.getAgentState(threadId);
    state.custom[key] = value;
  }

  getCustomState<T>(threadId: string, key: string): T | undefined {
    const state = this.getAgentState(threadId);
    return state.custom[key] as T | undefined;
  }

  // Snapshot

  getSnapshot(threadId: string, runId?: string): StateSnapshot | undefined {
    const thread = this.getThread(threadId);
    if (!thread) return undefined;

    return {
      thread,
      run: runId ? this.getRun(runId) : undefined,
      agent: this.getAgentState(threadId),
    };
  }
}
