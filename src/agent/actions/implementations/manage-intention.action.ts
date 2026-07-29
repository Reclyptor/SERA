import { z } from 'zod';
import { createHash } from 'crypto';
import type { IntentionsService } from '../../intentions/intentions.service';
import type {
  BackendAction,
  ActionExecutionContext,
  ActionExecutionResult,
} from '../action.interface';

const createOp = z.object({
  operation: z.literal('create'),
  kind: z
    .enum(['event_check_in', 'deadline_check', 'care_check_in', 'open_loop'])
    .default('open_loop')
    .describe('What kind of future follow-up this is'),
  suggestedText: z
    .string()
    .max(1000)
    .describe('The check-in message to send yourself when the time comes'),
  summary: z
    .string()
    .max(500)
    .optional()
    .describe(
      'A short private note of what you are tracking (never shown to the user)',
    ),
  delayMinutes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Become relevant this many minutes from now'),
  dueAt: z
    .string()
    .datetime()
    .optional()
    .describe(
      'ISO 8601 timestamp when this becomes relevant (overrides delayMinutes)',
    ),
});

const actOp = z.object({
  operation: z.literal('act'),
  intentionID: z.string().describe('ID of the intention you are acting on'),
});

const dismissOp = z.object({
  operation: z.literal('dismiss'),
  intentionID: z.string().describe('ID of the intention to let go of'),
});

const snoozeOp = z.object({
  operation: z.literal('snooze'),
  intentionID: z.string().describe('ID of the intention to revisit later'),
  snoozeMinutes: z
    .number()
    .int()
    .positive()
    .describe('Revisit this many minutes from now'),
});

// Internal, strict per-operation contract: enforces which fields are required
// for each `operation` and gives `execute` a discriminated, narrowed arg type.
const operationSchemas = z.discriminatedUnion('operation', [
  createOp,
  actOp,
  dismissOp,
  snoozeOp,
]);

// Wire schema handed to the model. A tool's `input_schema` MUST be a single
// object schema — a top-level discriminated union serializes to `anyOf` with
// no `type`, which the Anthropic API rejects with
// `input_schema.type: Field required`, failing the ENTIRE request (every tool,
// every run). So the wire shape is one flat object with all fields optional;
// `operationSchemas` re-validates the per-operation requirements in `execute`.
const parameters = z.object({
  operation: z
    .enum(['create', 'act', 'dismiss', 'snooze'])
    .describe(
      "Which lifecycle action to take. 'create' schedules a new self-check-in; " +
        "'act' / 'dismiss' / 'snooze' resolve an intention that was surfaced to you (by its ID).",
    ),
  kind: z
    .enum(['event_check_in', 'deadline_check', 'care_check_in', 'open_loop'])
    .optional()
    .describe(
      "[create] What kind of future follow-up this is (default 'open_loop')",
    ),
  suggestedText: z
    .string()
    .max(1000)
    .optional()
    .describe(
      '[create] The check-in message to send yourself when the time comes',
    ),
  summary: z
    .string()
    .max(500)
    .optional()
    .describe(
      '[create] A short private note of what you are tracking (never shown to the user)',
    ),
  delayMinutes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('[create] Become relevant this many minutes from now'),
  dueAt: z
    .string()
    .datetime()
    .optional()
    .describe(
      '[create] ISO 8601 timestamp when this becomes relevant (overrides delayMinutes)',
    ),
  intentionID: z
    .string()
    .optional()
    .describe('[act/dismiss/snooze] ID of the intention you are resolving'),
  snoozeMinutes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('[snooze] Revisit this many minutes from now'),
});

/**
 * Lets the agent curate its own standing intentions (§30.9 Phase 4): create a
 * future self-check-in, or resolve one that was surfaced to it (act / snooze /
 * dismiss). This is what turns the one-shot surfacing of Phase 2 into a real
 * self-managed lifecycle.
 */
export class ManageIntentionAction implements BackendAction<typeof parameters> {
  readonly name = 'manage_intention';
  readonly description =
    "Manage your own future follow-ups ('intentions'). operation:'create' schedules a self-check-in about something worth returning to; 'act'/'dismiss'/'snooze' resolve an intention that was surfaced to you (by its ID). Use this to decide what to keep caring about rather than letting items resurface unattended.";
  readonly parameters = parameters;

  constructor(private readonly intentionsService: IntentionsService) {}

  async execute(
    rawArgs: z.infer<typeof parameters>,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const parsed = operationSchemas.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.join('.') || 'arguments'}: ${issue.message}`,
          )
          .join('; '),
      };
    }
    const args = parsed.data;

    switch (args.operation) {
      case 'create':
        return this.create(args, context);
      case 'act': {
        const updated = await this.intentionsService.act(args.intentionID);
        return this.resolveResult(updated, args.intentionID, 'acted');
      }
      case 'dismiss': {
        const updated = await this.intentionsService.dismiss(args.intentionID);
        return this.resolveResult(updated, args.intentionID, 'dismissed');
      }
      case 'snooze': {
        const until = new Date(Date.now() + args.snoozeMinutes * 60_000);
        const updated = await this.intentionsService.snooze(
          args.intentionID,
          until,
        );
        return this.resolveResult(updated, args.intentionID, 'snoozed');
      }
    }
  }

  private async create(
    args: z.infer<typeof createOp>,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    if (!context.agentID || !context.userID) {
      return {
        success: false,
        error: 'agentID and userID are required to create an intention',
      };
    }

    const inferred = args.dueAt
      ? new Date(args.dueAt)
      : args.delayMinutes
        ? new Date(Date.now() + args.delayMinutes * 60_000)
        : undefined;
    const validInferred =
      inferred && !Number.isNaN(inferred.getTime()) ? inferred : undefined;
    const earliestAt = await this.intentionsService.clampEarliest(
      validInferred,
      context.agentID,
    );

    const subject = (args.summary ?? args.suggestedText).toLowerCase().trim();
    const dedupeKey = createHash('sha256')
      .update(`${context.agentID}|${args.kind}|${subject}`)
      .digest('hex');

    const saved = await this.intentionsService.upsert({
      agentID: context.agentID,
      userID: context.userID,
      kind: args.kind,
      summary: args.summary ?? subject,
      suggestedText: args.suggestedText,
      confidence: 1,
      earliestAt,
      dedupeKey,
      sourceRunID: context.runID,
      sourceThreadID: context.threadID,
    });

    return {
      success: true,
      result: {
        intentionID: saved?.intentionID,
        earliestAt: earliestAt.toISOString(),
      },
    };
  }

  private resolveResult(
    updated: unknown,
    intentionID: string,
    status: string,
  ): ActionExecutionResult {
    if (!updated) {
      return { success: false, error: `Intention ${intentionID} not found` };
    }
    return { success: true, result: { intentionID, status } };
  }
}
