import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ContextState, ContextStateDocument } from './context-state.schema';

const DEFAULT_MAX_AGE_DAYS = 7;
const DEFAULT_MAX_GENERATIONS = 10;

export interface PersistedSummary {
  text: string;
  updatedAt: Date;
  generations: number;
  model: string;
}

export interface SummaryWriteInput {
  threadID: string;
  summaryText: string;
  decision: string;
  model: string;
  costCents: number;
  savingsRatio: number;
}

@Injectable()
export class SummaryStoreService {
  private readonly logger = new Logger(SummaryStoreService.name);
  private readonly maxAgeMs: number;
  private readonly maxGenerations: number;

  constructor(
    @InjectModel(ContextState.name)
    private readonly contextModel: Model<ContextStateDocument>,
    private readonly configService: ConfigService,
  ) {
    const ageDays = parseInt(
      this.configService.get<string>('CONTEXT_SUMMARY_MAX_AGE_DAYS') ??
        String(DEFAULT_MAX_AGE_DAYS),
      10,
    );
    this.maxAgeMs =
      (Number.isFinite(ageDays) && ageDays > 0
        ? ageDays
        : DEFAULT_MAX_AGE_DAYS) *
      24 *
      60 *
      60 *
      1000;
    const gens = parseInt(
      this.configService.get<string>('CONTEXT_SUMMARY_MAX_GENERATIONS') ??
        String(DEFAULT_MAX_GENERATIONS),
      10,
    );
    this.maxGenerations =
      Number.isFinite(gens) && gens > 0 ? gens : DEFAULT_MAX_GENERATIONS;
  }

  async load(threadID: string): Promise<PersistedSummary | null> {
    const doc = await this.contextModel.findOne({ threadID }).lean().exec();
    if (!doc) return null;
    if (!doc.summaryText || !doc.summaryUpdatedAt) return null;
    if (this.isStale(doc.summaryUpdatedAt, doc.summaryGenerations)) {
      this.logger.debug(
        `Stale summary for thread ${threadID} (gens=${doc.summaryGenerations}); ignoring`,
      );
      return null;
    }
    return {
      text: doc.summaryText,
      updatedAt: doc.summaryUpdatedAt,
      generations: doc.summaryGenerations,
      model: doc.lastSummaryModel ?? '',
    };
  }

  async save(input: SummaryWriteInput): Promise<void> {
    await this.contextModel.findOneAndUpdate(
      { threadID: input.threadID },
      {
        $set: {
          summaryText: input.summaryText,
          summaryUpdatedAt: new Date(),
          lastDecision: input.decision,
          lastSummaryCostCents: input.costCents,
          lastSummaryModel: input.model,
          lastSavingsRatio: input.savingsRatio,
        },
        $inc: { summaryGenerations: 1 },
      },
      { upsert: true, new: true },
    );
  }

  async noteDecision(threadID: string, decision: string): Promise<void> {
    await this.contextModel.findOneAndUpdate(
      { threadID },
      { $set: { lastDecision: decision } },
      { upsert: true },
    );
  }

  async delete(threadID: string): Promise<void> {
    await this.contextModel.deleteOne({ threadID }).exec();
  }

  private isStale(updatedAt: Date, generations: number): boolean {
    if (generations >= this.maxGenerations) return true;
    return Date.now() - updatedAt.getTime() > this.maxAgeMs;
  }
}
