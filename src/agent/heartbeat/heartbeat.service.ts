import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { HeartbeatConfig, HeartbeatConfigDocument } from './heartbeat.schema';
import { OrchestratorService } from '../orchestration/orchestrator.service';
import { AUTONOMOUS_RUN_CONFIG } from '../orchestration/orchestration.interfaces';
import { PromptsService } from '../../prompts/prompts.service';
import { CommitmentsService } from '../commitments/commitments.service';

@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private readonly formatters = new Map<string, Intl.DateTimeFormat>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(
    @InjectModel(HeartbeatConfig.name)
    private readonly heartbeatModel: Model<HeartbeatConfigDocument>,
    private readonly orchestrator: OrchestratorService,
    private readonly promptsService: PromptsService,
    private readonly commitmentsService: CommitmentsService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.tickInterval = setInterval(() => this.tick(), 60_000);
    this.logger.log('Heartbeat service started (1-minute tick)');
  }

  onModuleDestroy() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  // Scheduling

  private async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const now = new Date();
      const dueConfigs = await this.heartbeatModel
        .find({
          enabled: true,
          $or: [
            { nextRunAt: { $lte: now } },
            { nextRunAt: { $exists: false } },
          ],
        })
        .exec();

      for (const config of dueConfigs) {
        if (!this.isWithinActiveHours(config, now)) continue;

        try {
          await this.fire(config);
        } catch (err) {
          this.logger.error(
            `Heartbeat for agent "${config.agentID}" failed:`,
            err,
          );
        }
      }
    } catch (err) {
      this.logger.error('Heartbeat tick failed:', err);
    } finally {
      this.processing = false;
    }
  }

  private isWithinActiveHours(config: HeartbeatConfig, now: Date): boolean {
    if (!config.activeHours) return true;

    const { start, end, timezone } = config.activeHours;
    const formatter = this.getFormatter(timezone ?? 'UTC');
    const currentHour = parseInt(formatter.format(now), 10);

    if (start <= end) {
      return currentHour >= start && currentHour < end;
    }
    // Wraps midnight (e.g., 22 to 6)
    return currentHour >= start || currentHour < end;
  }

  private getFormatter(timezone: string): Intl.DateTimeFormat {
    let fmt = this.formatters.get(timezone);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone,
      });
      this.formatters.set(timezone, fmt);
    }
    return fmt;
  }

  private async fire(config: HeartbeatConfig): Promise<void> {
    const threadID = crypto.randomUUID();
    const runID = crypto.randomUUID();

    this.logger.log(
      `Firing heartbeat for agent "${config.agentID}" (run: ${runID})`,
    );

    let message =
      (await this.promptsService.get('heartbeat')) ??
      '[Heartbeat] Periodic check activated. Review pending tasks.';
    if (config.checklist.length > 0) {
      const items = config.checklist.map((item) => `- ${item}`).join('\n');
      message += `\n\nChecklist:\n${items}`;
    }

    try {
      const dueCommitments = await this.commitmentsService.findDue(config.agentID);
      if (dueCommitments.length > 0) {
        const lines = dueCommitments.map(
          (c) =>
            `- ${c.description}${c.dueAt ? ` (due: ${c.dueAt.toISOString()})` : ''}`,
        );
        message += `\n\n## Pending Commitments\n${lines.join('\n')}`;
      }
    } catch {
      // Non-critical
    }

    const nextRunAt = new Date(Date.now() + config.intervalMinutes * 60_000);

    await this.heartbeatModel.updateOne(
      { agentID: config.agentID },
      { lastRunAt: new Date(), nextRunAt },
    );

    this.orchestrator
      .executeGoal(
        {
          threadID,
          runID,
          userID: `heartbeat:${config.agentID}`,
          agentID: config.agentID,
          userMessage: message,
          conversationHistory: [],
          isHeartbeat: true,
          modelOptions: { maxOutputTokens: config.maxTokens },
        },
        {
          ...AUTONOMOUS_RUN_CONFIG,
          wallClockTimeoutMs: parseInt(
            this.configService.get<string>(
              'AUTONOMOUS_WALL_CLOCK_TIMEOUT_MS',
              String(AUTONOMOUS_RUN_CONFIG.wallClockTimeoutMs),
            ),
            10,
          ) || AUTONOMOUS_RUN_CONFIG.wallClockTimeoutMs,
        },
      )
      .catch((err) => {
        this.logger.error(`Heartbeat run ${runID} failed:`, err);
      });
  }

  // CRUD

  async create(data: {
    agentID: string;
    intervalMinutes?: number;
    activeHours?: { start: number; end: number; timezone?: string };
    checklist?: string[];
    maxTokens?: number;
    enabled?: boolean;
  }): Promise<HeartbeatConfig> {
    const nextRunAt = new Date(
      Date.now() + (data.intervalMinutes ?? 30) * 60_000,
    );
    return this.heartbeatModel.create({
      ...data,
      nextRunAt,
    });
  }

  async findAll(): Promise<HeartbeatConfig[]> {
    return this.heartbeatModel.find().sort({ createdAt: -1 }).exec();
  }

  async findByAgent(agentID: string): Promise<HeartbeatConfig | null> {
    return this.heartbeatModel.findOne({ agentID }).exec();
  }

  async update(
    agentID: string,
    data: Partial<{
      intervalMinutes: number;
      activeHours: { start: number; end: number; timezone?: string };
      checklist: string[];
      maxTokens: number;
      enabled: boolean;
    }>,
  ): Promise<HeartbeatConfig | null> {
    const update: Record<string, unknown> = { ...data };

    if (data.intervalMinutes) {
      update.nextRunAt = new Date(Date.now() + data.intervalMinutes * 60_000);
    }

    return this.heartbeatModel
      .findOneAndUpdate({ agentID }, { $set: update }, { new: true })
      .exec();
  }

  async remove(agentID: string): Promise<boolean> {
    const result = await this.heartbeatModel.deleteOne({ agentID }).exec();
    return result.deletedCount > 0;
  }
}
