import { z } from 'zod';
import { randomUUID } from 'crypto';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

interface StateServiceLike {
  createThread(
    threadId?: string,
  ): Promise<{ threadId: string; createdAt: Date }>;
  startRun(
    threadId: string,
    runId?: string,
  ): Promise<{
    runId: string;
    threadId: string;
    status: string;
    startedAt: Date;
  }>;
}

const parameters = z.object({
  goal: z
    .string()
    .optional()
    .describe('Goal or purpose for the new session'),
  agentId: z
    .string()
    .optional()
    .describe('Agent ID to route this session to a specific agent configuration'),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe('Additional metadata for the session'),
});

export class SessionsSpawnTool implements Tool<typeof parameters> {
  readonly name = 'sessions_spawn';
  readonly description =
    'Spawn a new agent session (thread + run). Creates a new thread and starts a run that can be managed independently.';
  readonly parameters = parameters;

  constructor(private readonly stateService: StateServiceLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { goal, agentId, metadata } = args;
    const threadId = randomUUID();

    try {
      const thread = await this.stateService.createThread(threadId);
      const run = await this.stateService.startRun(threadId);

      return {
        success: true,
        result: {
          threadId,
          runId: run.runId,
          status: run.status,
          goal,
          agentId,
          metadata,
          createdAt: thread.createdAt,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to spawn session',
      };
    }
  }
}
