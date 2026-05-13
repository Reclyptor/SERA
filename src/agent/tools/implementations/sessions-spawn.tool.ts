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
      threadID: string;
      runID: string;
      userID: string;
      agentID: string;
      userMessage: string;
      conversationHistory: unknown[];
    },
    config?: { maxSteps?: number; maxIterations?: number },
  ): Promise<void>;
}

export interface SpawnRouterLike {
  resolve(context: {
    userID?: string;
    chatID?: string;
    threadID?: string;
  }): Promise<string | null>;
}

export interface SpawnRunReaderLike {
  getRunResponse(runID: string): Promise<{
    status: string;
    response?: string;
  } | null>;
}

const parameters = z.object({
  goal: z
    .string()
    .describe('Goal or instruction for the spawned agent session'),
  agentID: z
    .string()
    .optional()
    .describe(
      'Agent ID to route this session to. If omitted, uses the default agent binding.',
    ),
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
  waitForResult: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, block until the spawned run completes and return its response. If false, return immediately with the runID.',
    ),
  timeoutMs: z
    .number()
    .optional()
    .default(120_000)
    .describe('Timeout in ms when waitForResult is true (default: 120000)'),
});

export class SessionsSpawnTool implements Tool<typeof parameters> {
  readonly name = 'sessions_spawn';
  readonly description =
    'Spawn a new agent session that executes a goal autonomously. Set waitForResult=true to block until it completes, or false to get a runID for polling via subagents.';
  readonly parameters = parameters;

  constructor(
    private readonly orchestrator: SpawnOrchestratorLike,
    private readonly router: SpawnRouterLike,
    private readonly runReader: SpawnRunReaderLike,
  ) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { goal, maxSteps, maxIterations, waitForResult, timeoutMs } = args;
    const threadID = randomUUID();
    const runID = randomUUID();

    const agentID =
      args.agentID ??
      (await this.router.resolve({
        userID: context.userID,
        threadID,
      }));

    if (!agentID) {
      return {
        success: false,
        error:
          'No agent could be resolved. Provide an agentID or ensure a default binding exists.',
      };
    }

    const goalPromise = this.orchestrator.executeGoal(
      {
        threadID,
        runID,
        userID: context.userID ?? `spawn:${context.agentID}`,
        agentID,
        userMessage: goal,
        conversationHistory: [],
      },
      { maxSteps, maxIterations },
    );

    const baseResult = { threadID, runID, agentID, goal };

    if (waitForResult) {
      try {
        await Promise.race([
          goalPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), timeoutMs),
          ),
        ]);

        const run = await this.runReader.getRunResponse(runID);
        return {
          success: true,
          result: {
            ...baseResult,
            status: run?.status ?? 'completed',
            response: run?.response ?? null,
          },
        };
      } catch (err) {
        if (err instanceof Error && err.message === 'timeout') {
          return {
            success: true,
            result: { ...baseResult, status: 'running', timedOut: true },
          };
        }
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Spawn failed',
        };
      }
    }

    goalPromise.catch(() => {});

    return {
      success: true,
      result: { ...baseResult, status: 'spawned' },
    };
  }
}
