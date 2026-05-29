import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface CronSchedulerLike {
  create(data: {
    agentID: string;
    schedule: string;
    command: string;
    description?: string;
    enabled?: boolean;
    script?: string;
    contextFromJobID?: string;
  }): Promise<{
    jobID: string;
    schedule: string;
    command: string;
    description: string;
    enabled: boolean;
    nextRunAt?: Date;
  }>;
  findAll(agentID?: string): Promise<
    Array<{
      jobID: string;
      agentID: string;
      schedule: string;
      command: string;
      description: string;
      enabled: boolean;
      script?: string;
      contextFromJobID?: string;
      lastRunAt?: Date;
      nextRunAt?: Date;
    }>
  >;
  remove(jobID: string): Promise<boolean>;
  setEnabled(jobID: string, enabled: boolean): Promise<unknown>;
}

const CRON_REGEX =
  /^(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)$/;

const parameters = z.object({
  operation: z
    .enum(['create', 'list', 'delete', 'enable', 'disable'])
    .describe('Operation to perform'),
  schedule: z
    .string()
    .optional()
    .describe(
      'Cron expression (required for create). E.g. "0 9 * * *" for daily at 9am',
    ),
  command: z
    .string()
    .optional()
    .describe(
      'Instruction or goal for the agent to execute on schedule (required for create)',
    ),
  description: z.string().optional().describe('Human-readable description'),
  script: z
    .string()
    .optional()
    .describe(
      'Shell command to run before the agent. Its stdout is injected into the prompt as data context.',
    ),
  contextFromJobID: z
    .string()
    .optional()
    .describe(
      'Job ID whose last run response is injected as context for this job.',
    ),
  jobID: z
    .string()
    .optional()
    .describe('Job ID (required for delete/enable/disable)'),
});

export class CronTool implements Tool<typeof parameters> {
  readonly name = 'cron';
  readonly description =
    'Manage persistent scheduled jobs. Jobs survive restarts and execute as autonomous agent runs on their cron schedule.';
  readonly parameters = parameters;

  constructor(private readonly scheduler: CronSchedulerLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    switch (args.operation) {
      case 'create':
        return this.create(args, context);
      case 'list':
        return this.list(context);
      case 'delete':
        return this.delete(args.jobID);
      case 'enable':
        return this.setEnabled(args.jobID, true);
      case 'disable':
        return this.setEnabled(args.jobID, false);
    }
  }

  private async create(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.schedule || !args.command) {
      return {
        success: false,
        error: 'Schedule and command are required for create operation',
      };
    }

    if (!CRON_REGEX.test(args.schedule)) {
      return {
        success: false,
        error: `Invalid cron expression: "${args.schedule}". Expected format: "* * * * *" (minute hour day month weekday)`,
      };
    }

    try {
      const job = await this.scheduler.create({
        agentID: context.agentID,
        schedule: args.schedule,
        command: args.command,
        description: args.description,
        script: args.script,
        contextFromJobID: args.contextFromJobID,
      });

      return {
        success: true,
        result: {
          jobID: job.jobID,
          schedule: job.schedule,
          command: job.command,
          description: job.description,
          nextRunAt: job.nextRunAt,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create job',
      };
    }
  }

  private async list(
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      const jobs = await this.scheduler.findAll(context.agentID);
      return {
        success: true,
        result: jobs.map((j) => ({
          jobID: j.jobID,
          agentID: j.agentID,
          schedule: j.schedule,
          command: j.command,
          description: j.description,
          enabled: j.enabled,
          lastRunAt: j.lastRunAt,
          nextRunAt: j.nextRunAt,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list jobs',
      };
    }
  }

  private async delete(
    jobID: string | undefined,
  ): Promise<ToolExecutionResult> {
    if (!jobID) {
      return {
        success: false,
        error: 'jobID is required for delete operation',
      };
    }

    const deleted = await this.scheduler.remove(jobID);
    if (!deleted) {
      return { success: false, error: `Job "${jobID}" not found` };
    }

    return { success: true, result: { deleted: jobID } };
  }

  private async setEnabled(
    jobID: string | undefined,
    enabled: boolean,
  ): Promise<ToolExecutionResult> {
    if (!jobID) {
      return {
        success: false,
        error: `jobID is required for ${enabled ? 'enable' : 'disable'} operation`,
      };
    }

    const job = await this.scheduler.setEnabled(jobID, enabled);
    if (!job) {
      return { success: false, error: `Job "${jobID}" not found` };
    }

    return { success: true, result: { jobID, enabled } };
  }

  renderResultSummary(
    args: z.infer<typeof parameters>,
    result: unknown,
  ): string {
    const op = args.operation;
    if (result == null || typeof result !== 'object') {
      return `[cron] ${op}`;
    }
    if (op === 'list' && Array.isArray(result)) {
      return `[cron] list -> ${result.length} jobs`;
    }
    const r = result as { jobID?: string; deleted?: string };
    const id = r.jobID ?? r.deleted ?? args.jobID;
    return id ? `[cron] ${op} ${id}` : `[cron] ${op}`;
  }
}
