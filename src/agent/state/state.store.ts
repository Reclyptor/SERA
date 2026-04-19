import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Thread, ThreadDocument } from './thread.schema';
import { Run, RunDocument } from './run.schema';
import {
  AgentState as AgentStateDoc,
  AgentStateDocument,
} from './agent-state.schema';
import {
  ThreadState,
  RunState,
  AgentState,
  ToolCall,
  StateSnapshot,
} from './state.interface';

@Injectable()
export class StateStore {
  private readonly logger = new Logger(StateStore.name);

  constructor(
    @InjectModel(Thread.name) private threadModel: Model<ThreadDocument>,
    @InjectModel(Run.name) private runModel: Model<RunDocument>,
    @InjectModel(AgentStateDoc.name)
    private agentStateModel: Model<AgentStateDocument>,
  ) {}

  // Thread operations

  async createThread(threadID: string): Promise<ThreadState> {
    const thread = await this.threadModel.create({
      threadID,
      toolCalls: [],
      metadata: {},
    });
    this.logger.debug(`Created thread: ${threadID}`);
    return this.toThreadState(thread);
  }

  async getThread(threadID: string): Promise<ThreadState | undefined> {
    const thread = await this.threadModel.findOne({ threadID }).exec();
    return thread ? this.toThreadState(thread) : undefined;
  }

  async getOrCreateThread(threadID: string): Promise<ThreadState> {
    const existing = await this.getThread(threadID);
    if (existing) return existing;
    return this.createThread(threadID);
  }

  async deleteThread(threadID: string): Promise<boolean> {
    await this.agentStateModel.deleteOne({ threadID }).exec();
    const result = await this.threadModel.deleteOne({ threadID }).exec();
    return result.deletedCount > 0;
  }

  // Tool call operations

  async addToolCall(
    threadID: string,
    toolCall: Omit<ToolCall, 'id' | 'timestamp' | 'status'>,
  ): Promise<ToolCall> {
    const fullToolCall: ToolCall = {
      ...toolCall,
      id: crypto.randomUUID(),
      status: 'pending',
      timestamp: new Date(),
    };

    await this.threadModel
      .findOneAndUpdate(
        { threadID },
        {
          $push: { toolCalls: fullToolCall },
          $setOnInsert: { threadID, metadata: {} },
        },
        { upsert: true },
      )
      .exec();

    return fullToolCall;
  }

  async updateToolCall(
    threadID: string,
    toolCallID: string,
    update: Partial<Pick<ToolCall, 'status' | 'result'>>,
  ): Promise<ToolCall | undefined> {
    const updateFields: Record<string, unknown> = {};
    if (update.status !== undefined) {
      updateFields['toolCalls.$.status'] = update.status;
    }
    if (update.result !== undefined) {
      updateFields['toolCalls.$.result'] = update.result;
    }

    const thread = await this.threadModel
      .findOneAndUpdate(
        { threadID, 'toolCalls.id': toolCallID },
        { $set: updateFields },
        { returnDocument: 'after' },
      )
      .exec();

    if (!thread) return undefined;
    return thread.toolCalls.find((tc) => tc.id === toolCallID) as
      | ToolCall
      | undefined;
  }

  // Run operations

  async createRun(runID: string, threadID: string): Promise<RunState> {
    const run = await this.runModel.create({
      runID,
      threadID,
      status: 'pending',
      startedAt: new Date(),
    });
    this.logger.debug(`Created run: ${runID} for thread: ${threadID}`);
    return this.toRunState(run);
  }

  async getRun(runID: string): Promise<RunState | undefined> {
    const run = await this.runModel.findOne({ runID }).exec();
    return run ? this.toRunState(run) : undefined;
  }

  async updateRun(
    runID: string,
    update: Partial<Pick<RunState, 'status' | 'completedAt' | 'error' | 'response'>>,
  ): Promise<RunState | undefined> {
    const run = await this.runModel
      .findOneAndUpdate(
        { runID },
        { $set: update },
        { returnDocument: 'after' },
      )
      .exec();
    return run ? this.toRunState(run) : undefined;
  }

  // Agent state operations

  async getAgentState(threadID: string): Promise<AgentState> {
    let state = await this.agentStateModel.findOne({ threadID }).exec();
    if (!state) {
      state = await this.agentStateModel.create({
        threadID,
        custom: {},
        pendingConfirmations: [],
      });
    }
    return this.toAgentState(state);
  }

  async updateAgentState(
    threadID: string,
    update: Partial<AgentState>,
  ): Promise<AgentState> {
    const state = await this.agentStateModel
      .findOneAndUpdate(
        { threadID },
        { $set: update },
        { returnDocument: 'after', upsert: true },
      )
      .exec();
    return this.toAgentState(state);
  }

  async setCustomState(
    threadID: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    await this.agentStateModel
      .findOneAndUpdate(
        { threadID },
        { $set: { [`custom.${key}`]: value } },
        { upsert: true },
      )
      .exec();
  }

  async getCustomState<T>(
    threadID: string,
    key: string,
  ): Promise<T | undefined> {
    const state = await this.agentStateModel.findOne({ threadID }).exec();
    return state?.custom?.[key] as T | undefined;
  }

  async addPendingConfirmation(
    threadID: string,
    confirmation: AgentState['pendingConfirmations'][0],
  ): Promise<void> {
    await this.agentStateModel
      .findOneAndUpdate(
        { threadID },
        {
          $push: { pendingConfirmations: confirmation },
          $setOnInsert: { threadID, custom: {} },
        },
        { upsert: true },
      )
      .exec();
  }

  async resolveConfirmation(
    threadID: string,
    confirmationID: string,
    decision: { approved: boolean; feedback?: string; resolvedBy?: string },
  ): Promise<boolean> {
    const result = await this.agentStateModel
      .findOneAndUpdate(
        { threadID, 'pendingConfirmations.id': confirmationID },
        {
          $set: {
            'pendingConfirmations.$.status': decision.approved
              ? 'approved'
              : 'rejected',
            'pendingConfirmations.$.feedback': decision.feedback,
            'pendingConfirmations.$.resolvedBy': decision.resolvedBy,
            'pendingConfirmations.$.resolvedAt': new Date(),
          },
        },
      )
      .exec();
    return result !== null;
  }

  async getConfirmation(
    threadID: string,
    confirmationID: string,
  ): Promise<AgentState['pendingConfirmations'][0] | undefined> {
    const state = await this.agentStateModel
      .findOne({ threadID, 'pendingConfirmations.id': confirmationID })
      .exec();
    const found = state?.pendingConfirmations?.find(
      (c: { id: string }) => c.id === confirmationID,
    );
    if (!found) return undefined;
    return {
      ...found,
      status: found.status as 'pending' | 'approved' | 'rejected',
    };
  }

  async removePendingConfirmation(
    threadID: string,
    confirmationID: string,
  ): Promise<boolean> {
    const result = await this.agentStateModel
      .findOneAndUpdate(
        { threadID },
        { $pull: { pendingConfirmations: { id: confirmationID } } },
      )
      .exec();
    return result !== null;
  }

  // Snapshot

  async getSnapshot(
    threadID: string,
    runID?: string,
  ): Promise<StateSnapshot | undefined> {
    const thread = await this.getThread(threadID);
    if (!thread) return undefined;

    return {
      thread,
      run: runID ? await this.getRun(runID) : undefined,
      agent: await this.getAgentState(threadID),
    };
  }

  // Helpers

  private toThreadState(doc: ThreadDocument): ThreadState {
    return {
      threadID: doc.threadID,
      toolCalls: doc.toolCalls as ToolCall[],
      metadata: doc.metadata,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private toRunState(doc: RunDocument): RunState {
    return {
      runID: doc.runID,
      threadID: doc.threadID,
      status: doc.status as RunState['status'],
      startedAt: doc.startedAt,
      completedAt: doc.completedAt,
      error: doc.error,
    };
  }

  private toAgentState(doc: AgentStateDocument): AgentState {
    return {
      custom: doc.custom,
      currentStep: doc.currentStep,
      pendingConfirmations:
        doc.pendingConfirmations as AgentState['pendingConfirmations'],
    };
  }
}
