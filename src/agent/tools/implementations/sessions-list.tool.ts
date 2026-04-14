import { z } from 'zod';
import { Connection } from 'mongoose';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

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
  readonly description =
    'List active sessions (threads) and their runs. Shows session metadata and status.';
  readonly parameters = parameters;

  constructor(private readonly connection: Connection) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const limit = Math.max(1, Math.min(args.limit, 100));
    const { status } = args;

    try {
      const threads = this.connection.collection('threads');
      const runs = this.connection.collection('runs');

      let threadDocs: Array<Record<string, unknown>>;

      if (status !== 'all') {
        const matchingRuns = await runs
          .find({ status })
          .project({ threadId: 1 })
          .toArray();

        const threadIds = [
          ...new Set(matchingRuns.map((r) => r.threadId as string)),
        ];

        threadDocs = await threads
          .find({ threadId: { $in: threadIds } })
          .sort({ updatedAt: -1 })
          .limit(limit)
          .toArray();
      } else {
        threadDocs = await threads
          .find({})
          .sort({ updatedAt: -1 })
          .limit(limit)
          .toArray();
      }

      const sessions = await Promise.all(
        threadDocs.map(async (thread) => {
          const latestRun = await runs
            .find({ threadId: thread.threadId })
            .sort({ startedAt: -1 })
            .limit(1)
            .toArray();

          return {
            threadId: thread.threadId,
            metadata: thread.metadata ?? {},
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            latestRun: latestRun[0]
              ? {
                  runId: latestRun[0].runId,
                  status: latestRun[0].status,
                  startedAt: latestRun[0].startedAt,
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
