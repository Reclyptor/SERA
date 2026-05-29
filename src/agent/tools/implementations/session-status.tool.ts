import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

interface StateServiceLike {
  getSnapshot(
    threadID: string,
    runID?: string,
  ): Promise<
    | {
        thread: {
          threadID: string;
          metadata: Record<string, unknown>;
          createdAt: Date;
          updatedAt: Date;
        };
        run?: {
          runID: string;
          status: string;
          startedAt: Date;
          completedAt?: Date;
          error?: string;
        };
        agent: {
          custom: Record<string, unknown>;
          currentStep?: string;
        };
      }
    | undefined
  >;
}

const parameters = z.object({
  threadID: z.string().describe('Thread/session ID to check'),
  runID: z
    .string()
    .optional()
    .describe('Specific run ID (if omitted, shows thread state only)'),
});

export class SessionStatusTool implements Tool<typeof parameters> {
  readonly name = 'session_status';
  readonly parallelSafe = true;
  readonly description =
    'Get the current status of a session, including thread state, run status, and agent state.';
  readonly parameters = parameters;

  constructor(private readonly stateService: StateServiceLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { threadID, runID } = args;

    try {
      const snapshot = await this.stateService.getSnapshot(threadID, runID);

      if (!snapshot) {
        return { success: false, error: 'Session not found' };
      }

      return {
        success: true,
        result: {
          thread: snapshot.thread,
          run: snapshot.run,
          agent: snapshot.agent,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get session status',
      };
    }
  }

  renderResultSummary(
    args: z.infer<typeof parameters>,
    result: unknown,
  ): string {
    const target = args.runID
      ? `${args.threadID}/${args.runID}`
      : args.threadID;
    if (result == null || typeof result !== 'object') {
      return `[session_status] ${target}`;
    }
    const r = result as { run?: { status?: unknown } };
    const status =
      r.run && typeof r.run.status === 'string' ? r.run.status : 'no-run';
    return `[session_status] ${target} (${status})`;
  }
}
