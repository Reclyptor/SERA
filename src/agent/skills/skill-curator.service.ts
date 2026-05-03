import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Skill, SkillDocument } from './skill.schema';

const STALE_DAYS = 30;
const ARCHIVE_DAYS = 90;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

@Injectable()
export class SkillCuratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkillCuratorService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;

  constructor(
    @InjectModel(Skill.name)
    private readonly skillModel: Model<SkillDocument>,
    private readonly configService: ConfigService,
  ) {
    this.intervalMs = parseInt(
      this.configService.get<string>('SKILL_CURATOR_INTERVAL_MS', String(DEFAULT_INTERVAL_MS)),
      10,
    ) || DEFAULT_INTERVAL_MS;
  }

  onModuleInit() {
    this.timer = setInterval(() => {
      this.curate().catch((err) => {
        this.logger.error('Curator cycle failed:', err);
      });
    }, this.intervalMs);

    this.logger.log(
      `Skill curator started (interval: ${Math.round(this.intervalMs / 60_000)}m)`,
    );
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async curate(): Promise<{ staled: number; archived: number; reactivated: number }> {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_DAYS * 86_400_000);
    const archiveThreshold = new Date(now.getTime() - ARCHIVE_DAYS * 86_400_000);

    // Active → Stale: not used in 30 days
    const staleResult = await this.skillModel.updateMany(
      {
        status: 'active',
        seedHash: { $exists: false },
        $or: [
          { lastUsedAt: { $lt: staleThreshold } },
          { lastUsedAt: { $exists: false }, createdAt: { $lt: staleThreshold } },
        ],
      },
      {
        $set: {
          status: 'stale',
          curatorNotes: `Auto-staled: no usage since ${staleThreshold.toISOString().slice(0, 10)}`,
        },
      },
    );

    // Stale → Archived: not used in 90 days
    const archiveResult = await this.skillModel.updateMany(
      {
        status: 'stale',
        seedHash: { $exists: false },
        $or: [
          { lastUsedAt: { $lt: archiveThreshold } },
          { lastUsedAt: { $exists: false }, createdAt: { $lt: archiveThreshold } },
        ],
      },
      {
        $set: {
          status: 'archived',
          curatorNotes: `Auto-archived: no usage since ${archiveThreshold.toISOString().slice(0, 10)}`,
        },
      },
    );

    const counts = {
      staled: staleResult.modifiedCount,
      archived: archiveResult.modifiedCount,
      reactivated: 0,
    };

    if (counts.staled > 0 || counts.archived > 0) {
      this.logger.log(
        `Curator: ${counts.staled} staled, ${counts.archived} archived`,
      );
    }

    return counts;
  }
}
