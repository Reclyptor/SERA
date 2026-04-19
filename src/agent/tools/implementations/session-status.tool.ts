import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

interface StateServiceLike {
  getSnapshot(
    threadId: string,
    runId?: string,
  ): Promise<
    | {
        thread: {
          threadId: string;
          metadata: Record<string, unknown>;
          createdAt: Date;
          updatedAt: Date;
        };
        run?: {
          runId: string;
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
  threadId: z.string().describe('Thread/session ID to check'),
  runId: z
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
    const { threadId, runId } = args;

    try {
      const snapshot = await this.stateService.getSnapshot(threadId, runId);

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
}
