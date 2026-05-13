import { z } from 'zod';
import { randomUUID } from 'crypto';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

interface ChatServiceLike {
  appendMessage(
    chatID: string,
    message: { id: string; role: string; content: string; createdAt: Date },
  ): Promise<void>;
}

const parameters = z.object({
  targetChatID: z.string().describe('ID of the chat/session to send to'),
  content: z.string().describe('Message content'),
  role: z
    .enum(['assistant', 'system'])
    .optional()
    .default('assistant')
    .describe('Message role'),
});

export class SessionsSendTool implements Tool<typeof parameters> {
  readonly name = 'sessions_send';
  readonly description =
    'Send a message to another session/chat thread. Allows agents to communicate across sessions.';
  readonly parameters = parameters;

  constructor(private readonly chatService: ChatServiceLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { targetChatID, content, role } = args;
    const id = randomUUID();

    try {
      await this.chatService.appendMessage(targetChatID, {
        id,
        role,
        content,
        createdAt: new Date(),
      });

      return {
        success: true,
        result: { targetChatID, messageID: id, sent: true },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to send message',
      };
    }
  }
}
