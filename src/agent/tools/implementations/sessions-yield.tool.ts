import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface YieldStateServiceLike {
  setCustomState<T>(threadID: string, key: string, value: T): Promise<void>;
}

const parameters = z.object({
  message: z
    .string()
    .optional()
    .describe('Optional message explaining what the agent is waiting for'),
});

export class SessionsYieldTool implements Tool<typeof parameters> {
  readonly name = 'sessions_yield';
  readonly description =
    'End your current turn and wait for spawned subagent results. ' +
    'Use after calling sessions_spawn with waitForResult=false. ' +
    'Subagent results will be delivered as the next message in this thread.';
  readonly parameters = parameters;

  constructor(private readonly stateService: YieldStateServiceLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { threadID } = context;

    await this.stateService.setCustomState(threadID, 'yielding', true);
    await this.stateService.setCustomState(
      threadID,
      'yieldAgentID',
      context.agentID,
    );
    await this.stateService.setCustomState(
      threadID,
      'yieldUserID',
      context.userID ?? '',
    );
    if (typeof context.metadata?.chatID === 'string') {
      await this.stateService.setCustomState(
        threadID,
        'yieldChatID',
        context.metadata.chatID,
      );
    }
    await this.stateService.setCustomState(
      threadID,
      'yieldMessage',
      args.message ?? 'Waiting for subagent results.',
    );

    return {
      success: true,
      result: {
        yielded: true,
        message:
          'Turn yielded. You will receive subagent results as the next message.',
      },
    };
  }
}
