import { z } from 'zod';
import { Connection } from 'mongoose';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const parameters = z.object({
  operation: z
    .enum(['list', 'status', 'cancel'])
    .describe('Operation to perform'),
  runIDs: z
    .array(z.string())
    .optional()
    .describe('Run IDs to check status for or cancel'),
  threadID: z
    .string()
    .optional()
    .describe('Parent thread ID to list sub-agents for'),
});

export class SubagentsTool implements Tool<typeof parameters> {
  readonly name = 'subagents';
  readonly description =
    'Coordinate and manage sub-agents. List spawned sub-agents, check their status, or cancel them.';
  readonly parameters = parameters;

  constructor(private readonly connection: Connection) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { operation, runIDs, threadID } = args;

    try {
      const runs = this.connection.collection('runs');

      switch (operation) {
        case 'list': {
          const filter: Record<string, unknown> = {};
          if (threadID) filter.threadID = threadID;

          const docs = await runs
            .find(filter)
            .sort({ startedAt: -1 })
            .limit(50)
            .toArray();

          return {
            success: true,
            result: {
              agents: docs.map((d) => ({
                runID: d.runID,
                threadID: d.threadID,
                status: d.status,
                startedAt: d.startedAt,
                completedAt: d.completedAt,
              })),
            },
          };
        }

        case 'status': {
          if (!runIDs || runIDs.length === 0) {
            return {
              success: false,
              error: 'runIDs is required for status operation',
            };
          }

          const docs = await runs
            .find({ runID: { $in: runIDs } })
            .toArray();

          return {
            success: true,
            result: {
              agents: docs.map((d) => ({
                runID: d.runID,
                threadID: d.threadID,
                status: d.status,
                response: d.response ?? null,
              })),
            },
          };
        }

        case 'cancel': {
          if (!runIDs || runIDs.length === 0) {
            return {
              success: false,
              error: 'runIDs is required for cancel operation',
            };
          }

          const result = await runs.updateMany(
            { runID: { $in: runIDs }, status: 'running' },
            { $set: { status: 'cancelled', completedAt: new Date() } },
          );

          return {
            success: true,
            result: { cancelled: result.modifiedCount },
          };
        }
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Sub-agent operation failed',
      };
    }
  }
}
