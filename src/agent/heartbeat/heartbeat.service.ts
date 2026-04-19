import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  HeartbeatConfig,
  HeartbeatConfigDocument,
} from './heartbeat.schema';
import { OrchestratorService } from '../orchestration/orchestrator.service';

const DEFAULT_HEARTBEAT_MESSAGE =
  '[Heartbeat] You have been activated for a periodic check. ' +
  'Review any pending tasks, scheduled items, or proactive work you should do. ' +
  'If nothing needs attention, respond briefly.';

@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(
    @InjectModel(HeartbeatConfig.name)
    private readonly heartbeatModel: Model<HeartbeatConfigDocument>,
    private readonly orchestrator: OrchestratorService,
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
            `Heartbeat for agent "${config.agentId}" failed:`,
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

  private isWithinActiveHours(
    config: HeartbeatConfig,
    now: Date,
  ): boolean {
    if (!config.activeHours) return true;

    const { start, end, timezone } = config.activeHours;
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone ?? 'UTC',
    });
    const currentHour = parseInt(formatter.format(now), 10);

    if (start <= end) {
      return currentHour >= start && currentHour < end;
    }
    // Wraps midnight (e.g., 22 to 6)
    return currentHour >= start || currentHour < end;
  }

  private async fire(config: HeartbeatConfig): Promise<void> {
    const threadId = crypto.randomUUID();
    const runId = crypto.randomUUID();

    this.logger.log(
      `Firing heartbeat for agent "${config.agentId}" (run: ${runId})`,
    );

    let message = DEFAULT_HEARTBEAT_MESSAGE;
    if (config.checklist.length > 0) {
      const items = config.checklist.map((item) => `- ${item}`).join('\n');
      message += `\n\nChecklist:\n${items}`;
    }

    const nextRunAt = new Date(
      Date.now() + config.intervalMinutes * 60_000,
    );

    await this.heartbeatModel.updateOne(
      { agentId: config.agentId },
      { lastRunAt: new Date(), nextRunAt },
    );

    this.orchestrator
      .executeGoal(
        {
          threadId,
          runId,
          userId: `heartbeat:${config.agentId}`,
          agentId: config.agentId,
          userMessage: message,
          conversationHistory: [],
          isHeartbeat: true,
        },
        { maxSteps: 10, maxIterations: 2 },
      )
      .catch((err) => {
        this.logger.error(`Heartbeat run ${runId} failed:`, err);
      });
  }

  // CRUD

  async create(data: {
    agentId: string;
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

  async findByAgent(agentId: string): Promise<HeartbeatConfig | null> {
    return this.heartbeatModel.findOne({ agentId }).exec();
  }

  async update(
    agentId: string,
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
      update.nextRunAt = new Date(
        Date.now() + data.intervalMinutes * 60_000,
      );
    }

    return this.heartbeatModel
      .findOneAndUpdate({ agentId }, { $set: update }, { new: true })
      .exec();
  }

  async remove(agentId: string): Promise<boolean> {
    const result = await this.heartbeatModel
      .deleteOne({ agentId })
      .exec();
    return result.deletedCount > 0;
  }
}
