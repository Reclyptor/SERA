import { z } from 'zod';
import type { StateService } from '../../state/state.service';
import type { AgentEventEmitter } from '../../streaming/agent-event-emitter';
import type {
  BackendAction,
  ActionExecutionContext,
  ActionExecutionResult,
} from '../action.interface';

const parameters = z.object({
  message: z
    .string()
    .describe('Description of what the user is being asked to confirm'),
  actionName: z
    .string()
    .describe('Name of the action that needs confirmation'),
  actionArgs: z
    .record(z.unknown())
    .optional()
    .default({})
    .describe('Arguments for the action pending confirmation'),
});

export class RequestConfirmationAction
  implements BackendAction<typeof parameters>
{
  readonly name = 'request_confirmation';
  readonly description =
    'Request explicit user confirmation before proceeding with a sensitive or irreversible action. The run will pause until the user responds.';
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

    return {
      success: true,
      result: {
        confirmationId,
        message: 'Confirmation request sent to user. Awaiting response.',
      },
      pendingConfirmation: true,
    };
  }
}
