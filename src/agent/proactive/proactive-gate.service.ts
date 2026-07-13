import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import {
  HeartbeatConfig,
  HeartbeatConfigDocument,
} from '../heartbeat/heartbeat.schema';
import { isWithinActiveHours } from '../heartbeat/active-hours.util';

export interface ProactiveVerdict {
  allowed: boolean;
  reason?: string;
}

const WINDOW_MS = 86_400_000;

/**
 * Gates unsolicited outbound messages from autonomous runs (§30.3). Two floors
 * enforce the "balanced companion" posture: the user's active hours, and a
 * rolling 24h cap on proactive pushes per agent. A blocked message is held —
 * the caller is expected to snooze the driving intention rather than drop it.
 */
@Injectable()
export class ProactiveGateService {
  private readonly logger = new Logger(ProactiveGateService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectModel(HeartbeatConfig.name)
    private readonly heartbeatModel: Model<HeartbeatConfigDocument>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Whether an autonomous run may push to the user right now. Read-only: call
   * `record()` only after a message is actually delivered, so a suppressed or
   * failed send never consumes a slot.
   */
  async check(
    agentID: string,
    now: Date = new Date(),
  ): Promise<ProactiveVerdict> {
    if (
      this.config.get<string>('PROACTIVE_ACTIVE_HOURS_ENFORCED', 'true') ===
      'true'
    ) {
      const cfg = await this.heartbeatModel
        .findOne({ agentID })
        .select('activeHours')
        .lean()
        .exec();
      if (cfg?.activeHours && !isWithinActiveHours(cfg.activeHours, now)) {
        return { allowed: false, reason: "outside the user's active hours" };
      }
    }

    const max = this.maxPerDay();
    if (max <= 0) return { allowed: true };

    try {
      const key = this.rateKey(agentID);
      await this.redis.zremrangebyscore(key, 0, now.getTime() - WINDOW_MS);
      const count = await this.redis.zcard(key);
      if (count >= max) {
        return {
          allowed: false,
          reason: `daily proactive message limit reached (${max}/24h)`,
        };
      }
    } catch (err) {
      // Fail open: a broken rate-limiter must not silence a genuinely useful
      // message. Active hours — the spam floor — has already been enforced.
      this.logger.warn(
        `Proactive rate check failed, allowing: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { allowed: true };
  }

  /** Records a delivered proactive message against the rolling 24h window. */
  async record(agentID: string, now: Date = new Date()): Promise<void> {
    if (this.maxPerDay() <= 0) return;
    try {
      const key = this.rateKey(agentID);
      await this.redis.zadd(
        key,
        now.getTime(),
        `${now.getTime()}:${randomUUID()}`,
      );
      await this.redis.expire(key, Math.ceil(WINDOW_MS / 1000));
    } catch (err) {
      this.logger.warn(
        `Proactive rate record failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private maxPerDay(): number {
    const raw = parseInt(
      this.config.get<string>('PROACTIVE_MAX_PER_DAY', '6'),
      10,
    );
    return Number.isFinite(raw) ? raw : 6;
  }

  private rateKey(agentID: string): string {
    return `sera:proactive:${agentID}`;
  }
}
