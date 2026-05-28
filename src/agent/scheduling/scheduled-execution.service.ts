import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ScheduledExecution,
  ScheduledExecutionDocument,
  ScheduledExecutionKind,
  ScheduledExecutionStatus,
} from './scheduled-execution.schema';

const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;

@Injectable()
export class ScheduledExecutionService {
  readonly ownerID = `${process.pid}:${crypto.randomUUID()}`;

  constructor(
    @InjectModel(ScheduledExecution.name)
    private readonly executionModel: Model<ScheduledExecutionDocument>,
    private readonly configService: ConfigService,
  ) {}

  async ensurePending(data: {
    kind: ScheduledExecutionKind;
    targetID: string;
    agentID: string;
    scheduledFor: Date;
  }): Promise<ScheduledExecution> {
    const filter = {
      kind: data.kind,
      targetID: data.targetID,
      scheduledFor: data.scheduledFor,
    };

    try {
      return await this.executionModel
        .findOneAndUpdate(
          filter,
          {
            $setOnInsert: {
              executionID: crypto.randomUUID(),
              kind: data.kind,
              targetID: data.targetID,
              agentID: data.agentID,
              scheduledFor: data.scheduledFor,
              status: 'pending',
              runID: '',
              threadID: '',
              attempts: 0,
              leaseOwner: '',
              error: '',
            },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )
        .exec();
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) {
        throw error;
      }

      const existing = await this.executionModel.findOne(filter).exec();
      if (!existing) {
        throw error;
      }
      return existing;
    }
  }

  async claimNext(
    kind: ScheduledExecutionKind,
    now = new Date(),
  ): Promise<ScheduledExecution | null> {
    const leaseMs = this.getLeaseMs();
    const maxAttempts = this.getMaxAttempts();
    const runID = crypto.randomUUID();
    const threadID = crypto.randomUUID();

    const runningPatch = {
      status: 'running',
      runID,
      threadID,
      leaseOwner: this.ownerID,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      startedAt: now,
      error: '',
    };

    // 1. Prefer a fresh pending occurrence. The initial claim does NOT
    // consume the attempts cap — only lease-expiry reclaims do, matching
    // SPEC §20 ("Max claim attempts for expired scheduled executions").
    // A process that crashes between claim and any user-visible work
    // therefore does not burn one of the configured retries.
    const fromPending = await this.executionModel
      .findOneAndUpdate(
        {
          kind,
          scheduledFor: { $lte: now },
          status: 'pending',
        },
        { $set: runningPatch },
        { new: true, sort: { scheduledFor: 1, createdAt: 1 } },
      )
      .exec();

    if (fromPending) return fromPending;

    // 2. Otherwise reclaim a stale-lease running occurrence and bump
    // `attempts`. The `attempts: { $lt: maxAttempts }` filter halts
    // persistent crash loops at the configured cap.
    return this.executionModel
      .findOneAndUpdate(
        {
          kind,
          scheduledFor: { $lte: now },
          status: 'running',
          attempts: { $lt: maxAttempts },
          $or: [
            { leaseExpiresAt: { $lte: now } },
            { leaseExpiresAt: { $exists: false } },
          ],
        },
        {
          $set: runningPatch,
          $inc: { attempts: 1 },
        },
        { new: true, sort: { scheduledFor: 1, createdAt: 1 } },
      )
      .exec();
  }

  async renewLease(executionID: string): Promise<boolean> {
    const result = await this.executionModel
      .updateOne(
        {
          executionID,
          status: 'running',
          leaseOwner: this.ownerID,
        },
        {
          $set: {
            leaseExpiresAt: new Date(Date.now() + this.getLeaseMs()),
          },
        },
      )
      .exec();

    return result.modifiedCount > 0;
  }

  getRenewalIntervalMs(): number {
    return Math.max(1000, Math.floor(this.getLeaseMs() / 2));
  }

  async markTerminal(
    executionID: string,
    status: Extract<
      ScheduledExecutionStatus,
      'completed' | 'failed' | 'cancelled'
    >,
    error = '',
  ): Promise<void> {
    await this.executionModel
      .updateOne(
        {
          executionID,
          leaseOwner: this.ownerID,
        },
        {
          $set: {
            status,
            completedAt: new Date(),
            error,
          },
          $unset: {
            leaseExpiresAt: '',
          },
        },
      )
      .exec();
  }

  private getLeaseMs(): number {
    return (
      parseInt(
        this.configService.get<string>(
          'SCHEDULED_EXECUTION_LEASE_MS',
          String(DEFAULT_LEASE_MS),
        ),
        10,
      ) || DEFAULT_LEASE_MS
    );
  }

  private getMaxAttempts(): number {
    return (
      parseInt(
        this.configService.get<string>(
          'SCHEDULED_EXECUTION_MAX_ATTEMPTS',
          String(DEFAULT_MAX_ATTEMPTS),
        ),
        10,
      ) || DEFAULT_MAX_ATTEMPTS
    );
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }
}
