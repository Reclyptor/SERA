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
    const confirmationID = await this.stateService.addPendingConfirmation(
      context.threadID,
      args.actionName,
      args.actionArgs,
      args.message,
      context.runID,
    );

    void this.emitter.emitEvent(
      context.runID,
      context.threadID,
      'confirmation.required',
      {
        confirmationID,
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
        context.threadID,
        confirmationID,
      );

      if (!confirmation || confirmation.status === 'pending') continue;

      await this.stateService.removePendingConfirmation(
        context.threadID,
        confirmationID,
      );

      return {
        success: true,
        result: {
          confirmationID,
          decision: confirmation.status,
          approved: confirmation.status === 'approved',
          feedback: confirmation.feedback ?? null,
        },
      };
    }

    // Atomic timeout claim: if the user resolved between the last poll
    // and now, tryExpireConfirmation surfaces their decision instead of
    // silently dropping it. Only when we win the race do we emit
    // `timed_out`.
    const expired = await this.stateService.tryExpireConfirmation(
      context.threadID,
      confirmationID,
    );

    if (!expired.claimed && expired.resolution) {
      await this.stateService.removePendingConfirmation(
        context.threadID,
        confirmationID,
      );
      return {
        success: true,
        result: {
          confirmationID,
          decision: expired.resolution.status,
          approved: expired.resolution.status === 'approved',
          feedback: expired.resolution.feedback ?? null,
        },
      };
    }

    // We won the race — the pending confirmation has been removed from
    // the durable store. SPEC §29.6 requires emitting `approval.expired`
    // so SSE consumers (the UI confirmation widget) can dismiss the
    // pending prompt instead of waiting forever.
    void this.emitter.emitEvent(
      context.runID,
      context.threadID,
      'approval.expired',
      {
        confirmationID,
        actionName: args.actionName,
      },
    );

    return {
      success: true,
      result: {
        confirmationID,
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
