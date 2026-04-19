import { z } from 'zod';
import type { AgentEventEmitter } from '../../streaming/agent-event-emitter';
import type {
  BackendAction,
  ActionExecutionContext,
  ActionExecutionResult,
} from '../action.interface';

const parameters = z.object({
  title: z.string().describe('Notification title'),
  message: z.string().describe('Notification body'),
  level: z
    .enum(['info', 'warning', 'error', 'success'])
    .optional()
    .default('info')
    .describe('Notification severity level'),
});

export class NotificationAction implements BackendAction<typeof parameters> {
  readonly name = 'send_notification';
  readonly description =
    'Send a notification to the user in the frontend UI. Use for important updates, warnings, or completion alerts.';
  readonly parameters = parameters;

  constructor(private readonly emitter: AgentEventEmitter) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    this.emitter.emitEvent(context.runID, context.threadID, 'text.done', {
      content: `[${args.level.toUpperCase()}] ${args.title}: ${args.message}`,
      notification: {
        title: args.title,
        message: args.message,
        level: args.level,
      },
    });

    return { success: true, result: { sent: true } };
  }
}
