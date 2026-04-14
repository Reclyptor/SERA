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
import { StateService } from '../state/state.service';

@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(
    @InjectModel(HeartbeatConfig.name)
    private readonly heartbeatModel: Model<HeartbeatConfigDocument>,
    private readonly orchestrator: OrchestratorService,
    private readonly stateService: StateService,
  ) {}

  onModuleInit() {
    this.tickInterval = setInterval(() => this.tick(), 60_000);
    this.logger.log('Heartbeat scheduler started (1-minute tick)');
  }

  onModuleDestroy() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const now = new Date();
      const dueHeartbeats = await this.heartbeatModel
        .find({
          enabled: true,
          $or: [
            { nextRunAt: { $lte: now } },
            { nextRunAt: { $exists: false } },
          ],
        })
        .exec();

      for (const config of dueHeartbeats) {
        if (!this.isWithinActiveHours(config, now)) continue;

        try {
          await this.executeHeartbeat(config);
        } catch (err) {
          this.logger.error(
            `Heartbeat failed for agent "${config.agentId}":`,
            err,
          );
        }
      }
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

    let currentHour: number;
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone,
      });
      currentHour = parseInt(formatter.format(now), 10);
    } catch {
      currentHour = now.getUTCHours();
    }

    if (start <= end) {
      return currentHour >= start && currentHour < end;
    }
    // Wraps midnight (e.g. 22-06)
    return currentHour >= start || currentHour < end;
  }

  private async executeHeartbeat(config: HeartbeatConfig): Promise<void> {
    const threadId = crypto.randomUUID();
    const runId = crypto.randomUUID();

    const checklistText = config.checklist.length > 0
      ? config.checklist.map((item, i) => `${i + 1}. ${item}`).join('\n')
      : 'Check for any pending tasks or notifications.';

    const heartbeatMessage = [
      'HEARTBEAT — autonomous check-in.',
      '',
      'Work through the following checklist:',
      checklistText,
      '',
      'After completing each item, move to the next.',
      'If an item requires no action, skip it.',
    ].join('\n');

    this.logger.log(
      `Executing heartbeat for agent "${config.agentId}" (run: ${runId})`,
    );

    await this.orchestrator.executeGoal(
      {
        threadId,
        runId,
        userId: `heartbeat:${config.agentId}`,
        agentId: config.agentId,
        userMessage: heartbeatMessage,
        conversationHistory: [],
        isHeartbeat: true,
      },
      {
        maxSteps: 5,
        maxIterations: 1,
      },
    );

    const nextRunAt = new Date(
      Date.now() + config.intervalMinutes * 60_000,
    );
    await this.heartbeatModel.updateOne(
      { agentId: config.agentId },
      { lastRunAt: new Date(), nextRunAt },
    );

    this.logger.log(
      `Heartbeat complete for "${config.agentId}". Next run: ${nextRunAt.toISOString()}`,
    );
  }

  // CRUD

  async create(data: {
    agentId: string;
    intervalMinutes?: number;
    activeHours?: {
      start: number;
      end: number;
      timezone?: string;
    };
    checklist?: string[];
    maxTokens?: number;
    enabled?: boolean;
  }): Promise<HeartbeatConfig> {
    const config = new this.heartbeatModel({
      agentId: data.agentId,
      intervalMinutes: data.intervalMinutes ?? 30,
      activeHours: data.activeHours,
      checklist: data.checklist ?? [],
      maxTokens: data.maxTokens ?? 2048,
      enabled: data.enabled ?? false,
      nextRunAt: new Date(
        Date.now() + (data.intervalMinutes ?? 30) * 60_000,
      ),
    });
    return config.save();
  }

  async findAll(): Promise<HeartbeatConfig[]> {
    return this.heartbeatModel.find().exec();
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
    return this.heartbeatModel
      .findOneAndUpdate({ agentId }, { $set: data }, { new: true })
      .exec();
  }

  async remove(agentId: string): Promise<boolean> {
    const result = await this.heartbeatModel
      .deleteOne({ agentId })
      .exec();
    return result.deletedCount > 0;
  }
}
