import { z } from 'zod';
import { randomUUID } from 'crypto';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

async function withConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: (R | Error)[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      try {
        results[idx] = await fn(items[idx]);
      } catch (err) {
        results[idx] = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results as R[];
}

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

export interface SpawnStateServiceLike {
  setCustomState<T>(threadID: string, key: string, value: T): Promise<void>;
}

const parameters = z.object({
  goal: z
    .string()
    .optional()
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
  tasks: z
    .array(
      z.object({
        goal: z.string().describe('Goal for this sub-task'),
        agentID: z.string().optional().describe('Agent to handle this task'),
      }),
    )
    .optional()
    .describe(
      'Array of tasks to execute in parallel. When provided, goal parameter is ignored.',
    ),
  concurrency: z
    .number()
    .optional()
    .default(3)
    .describe('Maximum concurrent subagent runs when using tasks array'),
});

export class SessionsSpawnTool implements Tool<typeof parameters> {
  readonly name = 'sessions_spawn';
  readonly description =
    'Spawn one or more autonomous agent sessions. Provide a single goal, or a tasks array for parallel execution with concurrency control.';
  readonly parameters = parameters;

  constructor(
    private readonly orchestrator: SpawnOrchestratorLike,
    private readonly router: SpawnRouterLike,
    private readonly runReader: SpawnRunReaderLike,
    private readonly stateService?: SpawnStateServiceLike,
  ) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (args.tasks && args.tasks.length > 0) {
      return this.executeBatch(args, context);
    }

    if (!args.goal?.trim()) {
      return {
        success: false,
        error: 'goal is required unless tasks are provided',
      };
    }

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

    if (this.stateService) {
      await this.stateService.setCustomState(
        threadID,
        'parentThreadID',
        context.threadID,
      );
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

  private async executeBatch(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tasks = args.tasks!;
    const concurrency = args.concurrency ?? 3;
    const timeoutMs = args.timeoutMs ?? 120_000;

    const spawnTask = async (task: { goal: string; agentID?: string }) => {
      const threadID = randomUUID();
      const runID = randomUUID();
      const agentID =
        task.agentID ??
        (await this.router.resolve({
          userID: context.userID,
          threadID,
        })) ??
        context.agentID;

      const goalObj = {
        threadID,
        runID,
        userID: context.userID ?? `spawn:${agentID}`,
        agentID,
        userMessage: task.goal,
        conversationHistory: [] as unknown[],
      };

      if (this.stateService) {
        await this.stateService.setCustomState(
          threadID,
          'parentThreadID',
          context.threadID,
        );
      }

      const execPromise = this.orchestrator
        .executeGoal(goalObj, {
          maxSteps: args.maxSteps ?? 10,
          maxIterations: args.maxIterations ?? 2,
        })
        .catch(() => {});

      const result = await Promise.race([
        execPromise.then(async () => {
          const run = await this.runReader.getRunResponse(runID);
          return {
            threadID,
            runID,
            agentID,
            goal: task.goal,
            status: run?.status ?? 'completed',
            response: run?.response ?? '',
          };
        }),
        new Promise<{
          threadID: string;
          runID: string;
          agentID: string;
          goal: string;
          status: string;
          response: string;
        }>((resolve) =>
          setTimeout(
            () =>
              resolve({
                threadID,
                runID,
                agentID,
                goal: task.goal,
                status: 'timeout',
                response: '',
              }),
            timeoutMs,
          ),
        ),
      ]);

      return result;
    };

    const results = await withConcurrencyLimit(tasks, concurrency, spawnTask);

    const completed = results.filter((r) => r.status === 'completed').length;
    const failed = results.filter(
      (r) => r.status === 'failed' || r.status === 'timeout',
    ).length;

    return {
      success: true,
      result: {
        tasks: results,
        completedCount: completed,
        failedCount: failed,
        totalCount: tasks.length,
      },
    };
  }
}
