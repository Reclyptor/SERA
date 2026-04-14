import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

interface CronJob {
  id: string;
  schedule: string;
  command: string;
  description: string;
  enabled: boolean;
  createdAt: Date;
  lastRun: Date | null;
  nextRun: string | null;
}

const CRON_REGEX =
  /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/;

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
    .describe('Command or task to schedule (required for create)'),
  description: z.string().optional().describe('Human-readable description'),
  jobId: z
    .string()
    .optional()
    .describe('Job ID (required for delete/enable/disable)'),
});

export class CronTool implements Tool<typeof parameters> {
  readonly name = 'cron';
  readonly description =
    'Manage scheduled jobs. Create, list, delete, and view scheduled tasks.';
  readonly parameters = parameters;

  private static readonly jobs = new Map<string, CronJob>();

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    switch (args.operation) {
      case 'create':
        return this.create(args);
      case 'list':
        return this.list();
      case 'delete':
        return this.delete(args.jobId);
      case 'enable':
        return this.setEnabled(args.jobId, true);
      case 'disable':
        return this.setEnabled(args.jobId, false);
    }
  }

  private create(args: z.infer<typeof parameters>): ToolExecutionResult {
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

    const jobId = crypto.randomUUID();
    const job: CronJob = {
      id: jobId,
      schedule: args.schedule,
      command: args.command,
      description: args.description ?? '',
      enabled: true,
      createdAt: new Date(),
      lastRun: null,
      nextRun: null,
    };

    CronTool.jobs.set(jobId, job);

    return {
      success: true,
      result: {
        jobId,
        schedule: job.schedule,
        command: job.command,
        description: job.description,
      },
    };
  }

  private list(): ToolExecutionResult {
    return {
      success: true,
      result: Array.from(CronTool.jobs.values()),
    };
  }

  private delete(jobId: string | undefined): ToolExecutionResult {
    if (!jobId) {
      return { success: false, error: 'jobId is required for delete operation' };
    }

    if (!CronTool.jobs.has(jobId)) {
      return { success: false, error: `Job "${jobId}" not found` };
    }

    CronTool.jobs.delete(jobId);
    return { success: true, result: { deleted: jobId } };
  }

  private setEnabled(
    jobId: string | undefined,
    enabled: boolean,
  ): ToolExecutionResult {
    if (!jobId) {
      return {
        success: false,
        error: `jobId is required for ${enabled ? 'enable' : 'disable'} operation`,
      };
    }

    const job = CronTool.jobs.get(jobId);
    if (!job) {
      return { success: false, error: `Job "${jobId}" not found` };
    }

    job.enabled = enabled;
    CronTool.jobs.set(jobId, job);

    return { success: true, result: { jobId, enabled } };
  }
}
