import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CronExpressionParser } from 'cron-parser';
import { exec } from 'child_process';
import { ConfigService } from '@nestjs/config';
import { CronJob, CronJobDocument } from './cron-job.schema';
import { OrchestratorService } from '../orchestration/orchestrator.service';
import { AUTONOMOUS_RUN_CONFIG } from '../orchestration/orchestration.interfaces';
import { StateService } from '../state/state.service';

@Injectable()
export class CronSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CronSchedulerService.name);
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(
    @InjectModel(CronJob.name)
    private readonly cronJobModel: Model<CronJobDocument>,
    private readonly orchestrator: OrchestratorService,
    private readonly configService: ConfigService,
    private readonly stateService: StateService,
  ) {}

  onModuleInit() {
    this.tickInterval = setInterval(() => this.tick(), 60_000);
    this.logger.log('Cron scheduler started (1-minute tick)');
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
      const dueJobs = await this.cronJobModel
        .find({
          enabled: true,
          $or: [
            { nextRunAt: { $lte: now } },
            { nextRunAt: { $exists: false } },
          ],
        })
        .exec();

      for (const job of dueJobs) {
        try {
          await this.executeJob(job);
        } catch (err) {
          this.logger.error(`Cron job "${job.jobID}" failed:`, err);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async executeJob(job: CronJob): Promise<void> {
    const threadID = crypto.randomUUID();
    const runID = crypto.randomUUID();

    this.logger.log(
      `Executing cron job "${job.jobID}" for agent "${job.agentID}" (run: ${runID})`,
    );

    await this.cronJobModel.updateOne(
      { _id: (job as CronJobDocument)._id },
      { $set: { lastRunID: runID } },
    ).exec();

    const parts: string[] = [job.command];

    if (job.script) {
      const scriptOutput = await this.runScript(job.script);
      if (scriptOutput) {
        parts.push(`\n\n## Script Output\n\`\`\`\n${scriptOutput}\n\`\`\``);
      }
    }

    if (job.contextFromJobID) {
      try {
        const sourceJob = await this.cronJobModel.findOne({ jobID: job.contextFromJobID }).exec();
        if (sourceJob?.lastRunID) {
          const sourceRun = await this.stateService.getRun(sourceJob.lastRunID);
          if (sourceRun?.response) {
            parts.push(`\n\n## Context from job ${job.contextFromJobID}\n${sourceRun.response}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to load context from job ${job.contextFromJobID}:`, err);
      }
    }

    const userMessage = parts.join('');

    this.orchestrator
      .executeGoal(
        {
          threadID,
          runID,
          userID: `cron:${job.agentID}`,
          agentID: job.agentID,
          userMessage,
          conversationHistory: [],
          isHeartbeat: true,
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
        this.logger.error(`Cron run ${runID} failed:`, err);
      });

    const nextRunAt = this.computeNextRun(job.schedule);
    await this.cronJobModel.updateOne(
      { jobID: job.jobID },
      { lastRunAt: new Date(), nextRunAt },
    );
  }

  private async runScript(script: string): Promise<string> {
    const timeoutMs = parseInt(
      this.configService.get<string>('CRON_SCRIPT_TIMEOUT_MS', '10000'),
      10,
    ) || 10_000;

    return new Promise<string>((resolve) => {
      exec(script, { timeout: timeoutMs, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          this.logger.warn(`Cron script failed: ${err.message}`);
          resolve(stderr ? `[script error] ${stderr.trim()}` : `[script error] ${err.message}`);
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  computeNextRun(schedule: string): Date {
    try {
      const interval = CronExpressionParser.parse(schedule);
      return interval.next().toDate();
    } catch {
      this.logger.warn(
        `Invalid cron expression "${schedule}", defaulting to 30min`,
      );
      return new Date(Date.now() + 30 * 60_000);
    }
  }

  // CRUD

  async create(data: {
    agentID: string;
    schedule: string;
    command: string;
    description?: string;
    enabled?: boolean;
    script?: string;
    contextFromJobID?: string;
  }): Promise<CronJob> {
    const jobID = crypto.randomUUID();
    const nextRunAt = this.computeNextRun(data.schedule);

    const job = new this.cronJobModel({
      jobID,
      agentID: data.agentID,
      schedule: data.schedule,
      command: data.command,
      description: data.description ?? '',
      enabled: data.enabled ?? true,
      script: data.script ?? '',
      contextFromJobID: data.contextFromJobID ?? '',
      nextRunAt,
    });

    return job.save();
  }

  async findAll(agentID?: string): Promise<CronJob[]> {
    const filter = agentID ? { agentID } : {};
    return this.cronJobModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async findByID(jobID: string): Promise<CronJob | null> {
    return this.cronJobModel.findOne({ jobID }).exec();
  }

  async update(
    jobID: string,
    data: Partial<{
      schedule: string;
      command: string;
      description: string;
      enabled: boolean;
      script: string;
      contextFromJobID: string;
    }>,
  ): Promise<CronJob | null> {
    const update: Record<string, unknown> = { ...data };

    if (data.schedule) {
      update.nextRunAt = this.computeNextRun(data.schedule);
    }

    return this.cronJobModel
      .findOneAndUpdate({ jobID }, { $set: update }, { new: true })
      .exec();
  }

  async remove(jobID: string): Promise<boolean> {
    const result = await this.cronJobModel.deleteOne({ jobID }).exec();
    return result.deletedCount > 0;
  }

  async setEnabled(jobID: string, enabled: boolean): Promise<CronJob | null> {
    const update: Record<string, unknown> = { enabled };
    if (enabled) {
      const job = await this.findByID(jobID);
      if (job) {
        update.nextRunAt = this.computeNextRun(job.schedule);
      }
    }

    return this.cronJobModel
      .findOneAndUpdate({ jobID }, { $set: update }, { new: true })
      .exec();
  }
}
