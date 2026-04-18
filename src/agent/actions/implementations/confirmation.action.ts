import { z } from 'zod';
import type { StateService } from '../../state/state.service';
import type { AgentEventEmitter } from '../../streaming/agent-event-emitter';
import type {
  BackendAction,
  ActionExecutionContext,
  ActionExecutionResult,
} from '../action.interface';

const POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const parameters = z.object({
  message: z
    .string()
    .describe('Description of what the user is being asked to confirm'),
  actionName: z.string().describe('Name of the action that needs confirmation'),
  actionArgs: z
    .record(z.unknown())
    .optional()
    .default({})
    .describe('Arguments for the action pending confirmation'),
  timeoutMs: z
    .number()
    .optional()
    .describe('How long to wait for a response (default: 5 minutes)'),
});

export class RequestConfirmationAction implements BackendAction<
  typeof parameters
> {
  readonly name = 'request_confirmation';
  readonly description =
    'Request explicit user confirmation before proceeding with a sensitive or irreversible action. The run will pause until the user responds or the timeout is reached.';
  readonly parameters = parameters;

  constructor(
    private readonly stateService: StateService,
    private readonly emitter: AgentEventEmitter,
  ) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const confirmationId = await this.stateService.addPendingConfirmation(
      context.threadId,
      args.actionName,
      args.actionArgs,
      args.message,
      context.runId,
    );

    this.emitter.emitEvent(
      context.runId,
      context.threadId,
      'confirmation.required',
      {
        confirmationId,
        actionName: args.actionName,
        args: args.actionArgs,
        message: args.message,
      },
    );

    const timeout = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await this.sleep(POLL_INTERVAL_MS);

      const confirmation = await this.stateService.getConfirmation(
        context.threadId,
        confirmationId,
      );

      if (!confirmation || confirmation.status === 'pending') continue;

      await this.stateService.removePendingConfirmation(
        context.threadId,
        confirmationId,
      );

      return {
        success: true,
        result: {
          confirmationId,
          decision: confirmation.status,
          approved: confirmation.status === 'approved',
          feedback: confirmation.feedback ?? null,
        },
      };
    }

    await this.stateService.removePendingConfirmation(
      context.threadId,
      confirmationId,
    );

    return {
      success: true,
      result: {
        confirmationId,
        decision: 'timed_out',
        approved: false,
        feedback: null,
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
