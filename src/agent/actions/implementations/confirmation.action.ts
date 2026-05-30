import { z } from 'zod';
import type { StateService } from '../../state/state.service';
import type { ConfirmationSignalService } from '../../state/confirmation-signal.service';
import type { AgentEventEmitter } from '../../streaming/agent-event-emitter';
import type {
  BackendAction,
  ActionExecutionContext,
  ActionExecutionResult,
} from '../action.interface';

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
    private readonly signal: ConfirmationSignalService,
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

    const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Subscribe-then-reread: the listener attaches synchronously, then the
    // pre-check re-reads the durable store. A resolution that landed during
    // the gap between addPendingConfirmation and listener-attach is caught
    // by the pre-check; anything later is caught by the listener.
    const outcome = await this.signal.awaitResolution(
      context.threadID,
      confirmationID,
      timeoutMs,
      {
        preCheck: async () => {
          const fresh = await this.stateService.getConfirmation(
            context.threadID,
            confirmationID,
          );
          if (!fresh || fresh.status === 'pending') return null;
          return {
            status: fresh.status,
            feedback: fresh.feedback,
          };
        },
      },
    );

    if (outcome !== 'timeout') {
      await this.stateService.removePendingConfirmation(
        context.threadID,
        confirmationID,
      );
      return {
        success: true,
        result: {
          confirmationID,
          decision: outcome.status,
          approved: outcome.status === 'approved',
          feedback: outcome.feedback ?? null,
        },
      };
    }

    // Atomic timeout claim: if the user resolved between the last signal
    // check and the deadline (e.g., Pub/Sub dropped the message), the
    // claim fails and the durable store hands us their decision instead
    // of a silent timed_out.
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
}
