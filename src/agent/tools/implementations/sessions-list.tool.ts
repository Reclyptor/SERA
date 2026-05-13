import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface SessionsListStateLike {
  listThreads(options?: {
    limit?: number;
    sort?: 'asc' | 'desc';
    threadIDs?: string[];
  }): Promise<
    Array<{
      threadID: string;
      metadata: Record<string, unknown>;
      createdAt: Date;
      updatedAt: Date;
    }>
  >;
  listRuns(
    filter: { threadID?: string; status?: string },
    options?: { limit?: number; sort?: 'asc' | 'desc' },
  ): Promise<
    Array<{
      runID: string;
      threadID: string;
      status: string;
      startedAt: Date;
    }>
  >;
}

const parameters = z.object({
  limit: z
    .number()
    .optional()
    .default(20)
    .describe('Max sessions to return (1-100)'),
  status: z
    .enum(['running', 'completed', 'failed', 'cancelled', 'all'])
    .optional()
    .default('all')
    .describe('Filter by run status'),
});

export class SessionsListTool implements Tool<typeof parameters> {
  readonly name = 'sessions_list';
  readonly parallelSafe = true;
  readonly description =
    'List active sessions (threads) and their runs. Shows session metadata and status.';
  readonly parameters = parameters;

  constructor(private readonly stateService: SessionsListStateLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const limit = Math.max(1, Math.min(args.limit, 100));
    const { status } = args;

    try {
      let threads: Array<{
        threadID: string;
        metadata: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
      }>;

      if (status !== 'all') {
        const matchingRuns = await this.stateService.listRuns(
          { status: status },
          { limit: 500 },
        );

        const threadIDs = [...new Set(matchingRuns.map((r) => r.threadID))];

        threads = await this.stateService.listThreads({
          threadIDs,
          sort: 'desc',
          limit,
        });
      } else {
        threads = await this.stateService.listThreads({
          sort: 'desc',
          limit,
        });
      }

      const sessions = await Promise.all(
        threads.map(async (thread) => {
          const latestRuns = await this.stateService.listRuns(
            { threadID: thread.threadID },
            { limit: 1, sort: 'desc' },
          );

          return {
            threadID: thread.threadID,
            metadata: thread.metadata ?? {},
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            latestRun: latestRuns[0]
              ? {
                  runID: latestRuns[0].runID,
                  status: latestRuns[0].status,
                  startedAt: latestRuns[0].startedAt,
                }
              : undefined,
          };
        }),
      );

      return {
        success: true,
        result: { sessionCount: sessions.length, sessions },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to list sessions',
      };
    }
  }
}
