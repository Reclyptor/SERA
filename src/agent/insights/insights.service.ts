import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UsageRecord, UsageRecordDocument } from './usage.schema';
import { Chat, ChatDocument } from '../../chats/chat.schema';
import { calculateCost } from './pricing';

export interface RecordUsageParams {
  runID: string;
  userID: string;
  provider: string;
  modelID: string;
  tokens: {
    input: number;
    output: number;
    thinking?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  toolCallCount: number;
  durationMs: number;
  iterationCount: number;
}

export interface AggregateResult {
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRuns: number;
  totalToolCalls: number;
  byProvider: Record<
    string,
    {
      runs: number;
      costCents: number;
      inputTokens: number;
      outputTokens: number;
    }
  >;
  byModel: Record<
    string,
    {
      runs: number;
      costCents: number;
      inputTokens: number;
      outputTokens: number;
    }
  >;
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    @InjectModel(UsageRecord.name)
    private readonly usageModel: Model<UsageRecordDocument>,
    @InjectModel(Chat.name)
    private readonly chatModel: Model<ChatDocument>,
  ) {}

  async recordUsage(params: RecordUsageParams): Promise<void> {
    const costCents = calculateCost(params.modelID, params.tokens);

    await this.usageModel.create({
      runID: params.runID,
      userID: params.userID,
      provider: params.provider,
      modelID: params.modelID,
      tokens: {
        input: params.tokens.input,
        output: params.tokens.output,
        thinking: params.tokens.thinking ?? 0,
        cacheRead: params.tokens.cacheRead ?? 0,
        cacheWrite: params.tokens.cacheWrite ?? 0,
      },
      costCents,
      toolCallCount: params.toolCallCount,
      durationMs: params.durationMs,
      iterationCount: params.iterationCount,
    });

    this.logger.debug(
      `Recorded usage for run ${params.runID}: ${params.provider}/${params.modelID}, ` +
        `${params.tokens.input + params.tokens.output} tokens, $${costCents / 100}`,
    );
  }

  async getRunUsage(runID: string): Promise<UsageRecord[]> {
    return this.usageModel.find({ runID }).sort({ createdAt: 1 }).exec();
  }

  async getAggregate(
    userID: string,
    opts?: { since?: Date; until?: Date },
  ): Promise<AggregateResult> {
    const filter: Record<string, unknown> = { userID };
    if (opts?.since || opts?.until) {
      filter.createdAt = {};
      if (opts.since)
        (filter.createdAt as Record<string, Date>).$gte = opts.since;
      if (opts.until)
        (filter.createdAt as Record<string, Date>).$lte = opts.until;
    }

    const records = await this.usageModel.find(filter).exec();

    const result: AggregateResult = {
      totalCostCents: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRuns: records.length,
      totalToolCalls: 0,
      byProvider: {},
      byModel: {},
    };

    for (const r of records) {
      result.totalCostCents += r.costCents;
      result.totalInputTokens += r.tokens.input;
      result.totalOutputTokens += r.tokens.output;
      result.totalToolCalls += r.toolCallCount;

      if (!result.byProvider[r.provider]) {
        result.byProvider[r.provider] = {
          runs: 0,
          costCents: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
      const prov = result.byProvider[r.provider];
      prov.runs++;
      prov.costCents += r.costCents;
      prov.inputTokens += r.tokens.input;
      prov.outputTokens += r.tokens.output;

      if (!result.byModel[r.modelID]) {
        result.byModel[r.modelID] = {
          runs: 0,
          costCents: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
      const mod = result.byModel[r.modelID];
      mod.runs++;
      mod.costCents += r.costCents;
      mod.inputTokens += r.tokens.input;
      mod.outputTokens += r.tokens.output;
    }

    return result;
  }

  async getTopTools(
    userID: string,
    limit = 10,
  ): Promise<Array<{ tool: string; count: number }>> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    return this.chatModel
      .aggregate<{ tool: string; count: number }>([
        { $match: { userID } },
        { $unwind: '$messages' },
        { $unwind: '$messages.toolCalls' },
        {
          $group: {
            _id: '$messages.toolCalls.toolName',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
        { $limit: safeLimit },
        {
          $project: {
            _id: 0,
            tool: '$_id',
            count: 1,
          },
        },
      ])
      .exec();
  }
}
