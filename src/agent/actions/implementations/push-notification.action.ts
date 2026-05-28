import { z } from 'zod';
import type { NtfyService } from '../../ntfy/ntfy.service';
import type {
  BackendAction,
  ActionExecutionContext,
  ActionExecutionResult,
} from '../action.interface';

const viewActionSchema = z.object({
  action: z.literal('view'),
  label: z.string().max(60),
  url: z.string().url(),
  clear: z.boolean().optional(),
});

const httpActionSchema = z.object({
  action: z.literal('http'),
  label: z.string().max(60),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  clear: z.boolean().optional(),
});

const actionButtonSchema = z.discriminatedUnion('action', [
  viewActionSchema,
  httpActionSchema,
]);

const parameters = z.object({
  title: z
    .string()
    .max(200)
    .optional()
    .describe('Short headline shown above the message'),
  message: z.string().max(4000).describe('Notification body text'),
  priority: z
    .enum(['min', 'low', 'default', 'high', 'max'])
    .optional()
    .describe(
      'Urgency hint for the device. min/low are silent; default is normal; high/max trigger sound and vibration on phones.',
    ),
  tags: z
    .array(z.string())
    .max(5)
    .optional()
    .describe(
      'Emoji-rendering hints (e.g. "warning", "rocket", "white_check_mark", "fire"). Well-known names render as emoji in the title.',
    ),
  click: z
    .string()
    .url()
    .optional()
    .describe('URL opened when the user taps the notification'),
  actions: z
    .array(actionButtonSchema)
    .max(3)
    .optional()
    .describe(
      'Up to 3 quick-action buttons: "view" (opens a URL) or "http" (fires an HTTP request).',
    ),
});

export class PushNotificationAction implements BackendAction<
  typeof parameters
> {
  readonly name = 'send_push_notification';
  readonly description =
    "Send a push notification to the user's device(s) via ntfy. Use for off-session alerts when the user needs attention but may not be watching the chat. Distinct from send_notification, which signals within the active chat UI. Choose priority based on urgency.";
  readonly parameters = parameters;

  constructor(private readonly ntfyService: NtfyService) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    try {
      const result = await this.ntfyService.publish(args);
      return { success: true, result: { id: result.id } };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
