import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

interface ChatServiceLike {
  appendMessage(
    chatID: string,
    userID: string,
    message: { id: string; role: string; content: string; createdAt: Date },
  ): Promise<void>;
}

const parameters = z.object({
  chatID: z.string().describe('Target chat/thread ID to send the message to'),
  content: z.string().describe('Message content'),
  role: z
    .enum(['assistant', 'system'])
    .optional()
    .default('assistant')
    .describe('Message role'),
});

export class MessageTool implements Tool<typeof parameters> {
  readonly name = 'message';
  readonly description =
    'Send messages to chat threads. Use this to communicate with users or other agents through the messaging system.';
  readonly parameters = parameters;

  constructor(private readonly chatService: ChatServiceLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { chatID, content, role } = args;
    if (!context.userID) {
      return {
        success: false,
        error:
          'message tool requires a real user context; runs without a userID cannot write to user-owned chats',
      };
    }
    const messageID = crypto.randomUUID();

    try {
      await this.chatService.appendMessage(chatID, context.userID, {
        id: messageID,
        role,
        content,
        createdAt: new Date(),
      });

      return {
        success: true,
        result: { chatID, messageID, role, sent: true },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to send message',
      };
    }
  }

  renderResultSummary(
    args: z.infer<typeof parameters>,
    _result: unknown,
  ): string {
    const role = args.role ?? 'assistant';
    const len = args.content.length;
    return `[message] ${role} -> ${args.chatID} (${len} chars)`;
  }
}
