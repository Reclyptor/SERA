import { z } from 'zod';
import { randomUUID } from 'crypto';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface SpawnOrchestratorLike {
  executeGoal(
    goal: {
      threadId: string;
      runId: string;
      userId: string;
      agentId: string;
      userMessage: string;
      conversationHistory: unknown[];
    },
    config?: { maxSteps?: number; maxIterations?: number },
  ): Promise<void>;
}

export interface SpawnRouterLike {
  resolve(context: {
    userId?: string;
    chatId?: string;
    threadId?: string;
  }): Promise<string | null>;
}

const parameters = z.object({
  goal: z
    .string()
    .describe('Goal or instruction for the spawned agent session'),
  agentId: z
    .string()
    .optional()
    .describe('Agent ID to route this session to. If omitted, uses the default agent binding.'),
  maxSteps: z
    .number()
    .optional()
    .default(10)
    .describe('Max tool steps for the spawned run'),
  maxIterations: z
    .number()
    .optional()
    .default(2)
    .describe('Max outer loop iterations for the spawned run'),
});

export class SessionsSpawnTool implements Tool<typeof parameters> {
  readonly name = 'sessions_spawn';
  readonly description =
    'Spawn a new agent session that executes a goal autonomously. Returns immediately with the runId — use the subagents tool to poll for status and retrieve the response.';
  readonly parameters = parameters;

  constructor(
    private readonly orchestrator: SpawnOrchestratorLike,
    private readonly router: SpawnRouterLike,
  ) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { goal, maxSteps, maxIterations } = args;
    const threadId = randomUUID();
    const runId = randomUUID();

    const agentId =
      args.agentId ??
      (await this.router.resolve({
        userId: context.userId,
        threadId,
      }));

    if (!agentId) {
      return {
        success: false,
        error: 'No agent could be resolved. Provide an agentId or ensure a default binding exists.',
      };
    }

    this.orchestrator
      .executeGoal(
        {
          threadId,
          runId,
          userId: context.userId ?? `spawn:${context.agentId}`,
          agentId,
          userMessage: goal,
          conversationHistory: [],
        },
        { maxSteps, maxIterations },
      )
      .catch(() => {});

    return {
      success: true,
      result: {
        threadId,
        runId,
        agentId,
        goal,
        status: 'spawned',
      },
    };
  }
}
