import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Thread, ThreadDocument } from './schemas/thread.schema';
import { Run, RunDocument } from './schemas/run.schema';
import { AgentState as AgentStateDoc, AgentStateDocument } from './schemas/agent-state.schema';
import {
  ThreadState,
  RunState,
  AgentState,
  Message,
  ToolCall,
  StateSnapshot,
} from './interfaces/state.interface';

@Injectable()
export class StateStore {
  private readonly logger = new Logger(StateStore.name);

  constructor(
    @InjectModel(Thread.name) private threadModel: Model<ThreadDocument>,
    @InjectModel(Run.name) private runModel: Model<RunDocument>,
    @InjectModel(AgentStateDoc.name) private agentStateModel: Model<AgentStateDocument>,
  ) {}

  // Thread operations

  async createThread(threadId: string): Promise<ThreadState> {
    const thread = await this.threadModel.create({
      threadId,
      messages: [],
      toolCalls: [],
      metadata: {},
    });
    this.logger.debug(`Created thread: ${threadId}`);
    return this.toThreadState(thread);
  }

  async getThread(threadId: string): Promise<ThreadState | undefined> {
    const thread = await this.threadModel.findOne({ threadId }).exec();
    return thread ? this.toThreadState(thread) : undefined;
  }

  async getOrCreateThread(threadId: string): Promise<ThreadState> {
    const existing = await this.getThread(threadId);
    if (existing) return existing;
    return this.createThread(threadId);
  }

  async deleteThread(threadId: string): Promise<boolean> {
    await this.agentStateModel.deleteOne({ threadId }).exec();
    const result = await this.threadModel.deleteOne({ threadId }).exec();
    return result.deletedCount > 0;
  }

  // Message operations

  async addMessage(threadId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    const fullMessage: Message = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };

    await this.threadModel.findOneAndUpdate(
      { threadId },
      {
        $push: { messages: fullMessage },
        $setOnInsert: { threadId, toolCalls: [], metadata: {} },
      },
      { upsert: true },
    ).exec();

    return fullMessage;
  }

  async getMessages(threadId: string): Promise<Message[]> {
    const thread = await this.threadModel.findOne({ threadId }).exec();
    return thread?.messages as Message[] ?? [];
  }

  // Tool call operations

  async addToolCall(threadId: string, toolCall: Omit<ToolCall, 'id' | 'timestamp' | 'status'>): Promise<ToolCall> {
    const fullToolCall: ToolCall = {
      ...toolCall,
      id: crypto.randomUUID(),
      status: 'pending',
      timestamp: new Date(),
    };

    await this.threadModel.findOneAndUpdate(
      { threadId },
      {
        $push: { toolCalls: fullToolCall },
        $setOnInsert: { threadId, messages: [], metadata: {} },
      },
      { upsert: true },
    ).exec();

    return fullToolCall;
  }

  async updateToolCall(
    threadId: string,
    toolCallId: string,
    update: Partial<Pick<ToolCall, 'status' | 'result'>>,
  ): Promise<ToolCall | undefined> {
    const updateFields: Record<string, unknown> = {};
    if (update.status !== undefined) {
      updateFields['toolCalls.$.status'] = update.status;
    }
    if (update.result !== undefined) {
      updateFields['toolCalls.$.result'] = update.result;
    }

    const thread = await this.threadModel.findOneAndUpdate(
      { threadId, 'toolCalls.id': toolCallId },
      { $set: updateFields },
      { new: true },
    ).exec();

    if (!thread) return undefined;
    return thread.toolCalls.find((tc) => tc.id === toolCallId) as ToolCall | undefined;
  }

  // Run operations

  async createRun(runId: string, threadId: string): Promise<RunState> {
    const run = await this.runModel.create({
      runId,
      threadId,
      status: 'pending',
      startedAt: new Date(),
    });
    this.logger.debug(`Created run: ${runId} for thread: ${threadId}`);
    return this.toRunState(run);
  }

  async getRun(runId: string): Promise<RunState | undefined> {
    const run = await this.runModel.findOne({ runId }).exec();
    return run ? this.toRunState(run) : undefined;
  }

  async updateRun(
    runId: string,
    update: Partial<Pick<RunState, 'status' | 'completedAt' | 'error'>>,
  ): Promise<RunState | undefined> {
    const run = await this.runModel.findOneAndUpdate(
      { runId },
      { $set: update },
      { new: true },
    ).exec();
    return run ? this.toRunState(run) : undefined;
  }

  // Agent state operations

  async getAgentState(threadId: string): Promise<AgentState> {
    let state = await this.agentStateModel.findOne({ threadId }).exec();
    if (!state) {
      state = await this.agentStateModel.create({
        threadId,
        custom: {},
        pendingConfirmations: [],
      });
    }
    return this.toAgentState(state);
  }

  async updateAgentState(threadId: string, update: Partial<AgentState>): Promise<AgentState> {
    const state = await this.agentStateModel.findOneAndUpdate(
      { threadId },
      { $set: update },
      { new: true, upsert: true },
    ).exec();
    return this.toAgentState(state!);
  }

  async setCustomState(threadId: string, key: string, value: unknown): Promise<void> {
    await this.agentStateModel.findOneAndUpdate(
      { threadId },
      { $set: { [`custom.${key}`]: value } },
      { upsert: true },
    ).exec();
  }

  async getCustomState<T>(threadId: string, key: string): Promise<T | undefined> {
    const state = await this.agentStateModel.findOne({ threadId }).exec();
    return state?.custom?.[key] as T | undefined;
  }

  async addPendingConfirmation(
    threadId: string,
    confirmation: AgentState['pendingConfirmations'][0],
  ): Promise<void> {
    await this.agentStateModel.findOneAndUpdate(
      { threadId },
      {
        $push: { pendingConfirmations: confirmation },
        $setOnInsert: { threadId, custom: {} },
      },
      { upsert: true },
    ).exec();
  }

  async removePendingConfirmation(threadId: string, confirmationId: string): Promise<boolean> {
    const result = await this.agentStateModel.findOneAndUpdate(
      { threadId },
      { $pull: { pendingConfirmations: { id: confirmationId } } },
    ).exec();
    return result !== null;
  }

  // Snapshot

  async getSnapshot(threadId: string, runId?: string): Promise<StateSnapshot | undefined> {
    const thread = await this.getThread(threadId);
    if (!thread) return undefined;

    return {
      thread,
      run: runId ? await this.getRun(runId) : undefined,
      agent: await this.getAgentState(threadId),
    };
  }

  // Helpers

  private toThreadState(doc: ThreadDocument): ThreadState {
    return {
      threadId: doc.threadId,
      messages: doc.messages as Message[],
      toolCalls: doc.toolCalls as ToolCall[],
      metadata: doc.metadata as Record<string, unknown>,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private toRunState(doc: RunDocument): RunState {
    return {
      runId: doc.runId,
      threadId: doc.threadId,
      status: doc.status as RunState['status'],
      startedAt: doc.startedAt,
      completedAt: doc.completedAt,
      error: doc.error,
    };
  }

  private toAgentState(doc: AgentStateDocument): AgentState {
    return {
      custom: doc.custom as Record<string, unknown>,
      currentStep: doc.currentStep,
      pendingConfirmations: doc.pendingConfirmations as AgentState['pendingConfirmations'],
    };
  }
}
