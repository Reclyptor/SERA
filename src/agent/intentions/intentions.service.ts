import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Intention, IntentionDocument } from './intention.schema';
import {
  HeartbeatConfig,
  HeartbeatConfigDocument,
} from '../heartbeat/heartbeat.schema';

const DEFAULT_INTERVAL_MINUTES = 30;

export interface UpsertIntentionInput {
  agentID: string;
  userID: string;
  kind: string;
  summary: string;
  suggestedText: string;
  confidence: number;
  earliestAt: Date;
  dedupeKey: string;
  latestAt?: Date;
  timezone?: string;
  sourceRunID?: string;
  sourceThreadID?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class IntentionsService {
  private readonly logger = new Logger(IntentionsService.name);

  constructor(
    @InjectModel(Intention.name)
    private readonly intentionModel: Model<IntentionDocument>,
    @InjectModel(HeartbeatConfig.name)
    private readonly heartbeatModel: Model<HeartbeatConfigDocument>,
  ) {}

  /**
   * Anti-echo clamp (§30.4): an intention can never become due before the next
   * heartbeat tick, so it cannot fire on the same turn that created it.
   */
  async clampEarliest(
    inferredAt: Date | undefined,
    agentID: string,
    now: Date = new Date(),
  ): Promise<Date> {
    const cfg = await this.heartbeatModel
      .findOne({ agentID })
      .select('intervalMinutes')
      .lean()
      .exec();
    const intervalMs =
      (cfg?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES) * 60_000;
    const floor = new Date(now.getTime() + intervalMs);
    return !inferredAt || inferredAt < floor ? floor : inferredAt;
  }

  /**
   * Insert a new intention, or refresh an existing one with the same
   * (agentID, dedupeKey). Refresh never resurrects a dismissed/acted row's
   * status — it only updates confidence, wording, and timing.
   */
  async upsert(data: UpsertIntentionInput): Promise<Intention | null> {
    return this.intentionModel
      .findOneAndUpdate(
        { agentID: data.agentID, dedupeKey: data.dedupeKey },
        {
          $set: {
            confidence: data.confidence,
            summary: data.summary,
            suggestedText: data.suggestedText,
            earliestAt: data.earliestAt,
            ...(data.latestAt && { latestAt: data.latestAt }),
          },
          $setOnInsert: {
            intentionID: randomUUID(),
            userID: data.userID,
            kind: data.kind,
            timezone: data.timezone ?? 'UTC',
            status: 'pending',
            sourceRunID: data.sourceRunID ?? '',
            sourceThreadID: data.sourceThreadID ?? '',
            surfacedRunID: '',
            tags: data.tags ?? [],
            metadata: data.metadata ?? {},
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /** Intentions ready to be surfaced at a heartbeat: due, not snoozed forward. */
  async findDue(agentID: string, now: Date = new Date()): Promise<Intention[]> {
    return this.intentionModel
      .find({
        agentID,
        status: { $in: ['pending', 'snoozed'] },
        earliestAt: { $lte: now },
        $or: [
          { snoozedUntil: { $exists: false } },
          { snoozedUntil: { $lte: now } },
        ],
      })
      .sort({ earliestAt: 1 })
      .exec();
  }

  async markSurfaced(
    intentionID: string,
    runID: string,
  ): Promise<Intention | null> {
    return this.intentionModel
      .findOneAndUpdate(
        { intentionID },
        { $set: { status: 'surfaced', surfacedRunID: runID } },
        { new: true },
      )
      .exec();
  }

  async act(intentionID: string): Promise<Intention | null> {
    return this.setStatus(intentionID, 'acted');
  }

  async dismiss(intentionID: string): Promise<Intention | null> {
    return this.setStatus(intentionID, 'dismissed');
  }

  async snooze(intentionID: string, until: Date): Promise<Intention | null> {
    return this.intentionModel
      .findOneAndUpdate(
        { intentionID },
        { $set: { status: 'snoozed', snoozedUntil: until } },
        { new: true },
      )
      .exec();
  }

  /** Intentions the agent chose to act on since `cutoff` — input to dreaming. */
  async findActedSince(cutoff: Date): Promise<Intention[]> {
    return this.intentionModel
      .find({ status: 'acted', updatedAt: { $gte: cutoff } })
      .sort({ updatedAt: 1 })
      .exec();
  }

  /** Retires intentions whose latest-relevant time has passed unacted. */
  async expire(now: Date = new Date()): Promise<number> {
    const result = await this.intentionModel.updateMany(
      {
        status: { $in: ['pending', 'snoozed', 'surfaced'] },
        latestAt: { $lte: now },
      },
      { $set: { status: 'expired' } },
    );
    return result.modifiedCount;
  }

  async findAll(filters?: {
    agentID?: string;
    userID?: string;
    status?: string;
  }): Promise<Intention[]> {
    const query: Record<string, unknown> = {};
    if (filters?.agentID) query.agentID = filters.agentID;
    if (filters?.userID) query.userID = filters.userID;
    if (filters?.status) query.status = filters.status;
    return this.intentionModel.find(query).sort({ createdAt: -1 }).exec();
  }

  private async setStatus(
    intentionID: string,
    status: string,
  ): Promise<Intention | null> {
    return this.intentionModel
      .findOneAndUpdate({ intentionID }, { $set: { status } }, { new: true })
      .exec();
  }
}
