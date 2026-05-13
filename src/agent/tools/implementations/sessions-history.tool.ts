import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

interface ChatServiceLike {
  loadConversationHistory(
    chatID: string,
  ): Promise<Array<{ role: string; content: string }>>;
}

const parameters = z.object({
  chatID: z.string().describe('Chat/session ID to fetch history for'),
  limit: z
    .number()
    .optional()
    .default(50)
    .describe('Max messages to return (1-200)'),
  offset: z.number().optional().default(0).describe('Skip first N messages'),
});

export class SessionsHistoryTool implements Tool<typeof parameters> {
  readonly name = 'sessions_history';
  readonly parallelSafe = true;
  readonly description =
    'Fetch the message history (transcript) for a chat session.';
  readonly parameters = parameters;

  constructor(private readonly chatService: ChatServiceLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { chatID } = args;
    const limit = Math.max(1, Math.min(args.limit, 200));
    const offset = Math.max(0, args.offset);

    try {
      const messages = await this.chatService.loadConversationHistory(chatID);
      const sliced = messages.slice(offset, offset + limit);

      return {
        success: true,
        result: {
          chatID,
          totalMessages: messages.length,
          returned: sliced.length,
          messages: sliced,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch session history',
      };
    }
  }
}
