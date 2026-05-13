import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface SubagentsStateLike {
  listRuns(
    filter: { threadID?: string; runIDs?: string[] },
    options?: { limit?: number; sort?: 'asc' | 'desc' },
  ): Promise<
    Array<{
      runID: string;
      threadID: string;
      status: string;
      startedAt: Date;
      completedAt?: Date;
      response?: string;
    }>
  >;
  cancelRuns(runIDs: string[]): Promise<number>;
}

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

  constructor(private readonly stateService: SubagentsStateLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { operation, runIDs, threadID } = args;

    try {
      switch (operation) {
        case 'list': {
          const runs = await this.stateService.listRuns(
            { threadID },
            { limit: 50, sort: 'desc' },
          );

          return {
            success: true,
            result: {
              agents: runs.map((d) => ({
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

          const runs = await this.stateService.listRuns({ runIDs });

          return {
            success: true,
            result: {
              agents: runs.map((d) => ({
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

          const cancelled = await this.stateService.cancelRuns(runIDs);

          return {
            success: true,
            result: { cancelled },
          };
        }
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Sub-agent operation failed',
      };
    }
  }
}
