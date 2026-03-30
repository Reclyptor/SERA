import { Injectable, Logger } from '@nestjs/common';
import { MemoryService } from './memory/memory.service';
import { PromptsService } from '../prompts/prompts.service';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly memoryService: MemoryService,
    private readonly promptsService: PromptsService,
  ) {
    this.logger.log('Agent service initialized');
  }

  /**
   * Build the full system prompt with memory context.
   */
  async buildSystemPrompt(userId?: string, query?: string): Promise<string> {
    const parts: string[] = [];

    // Base system prompt from database/cache
    try {
      const systemPrompt = await this.promptsService.get('system');
      if (systemPrompt) {
        parts.push(systemPrompt);
      }
    } catch {
      // Never fail because of prompt retrieval errors
    }

    // Memory context
    if (userId && query) {
      try {
        const memoryContext = await this.memoryService.getContextForQuery(
          userId,
          query,
        );
        if (memoryContext) {
          parts.push(memoryContext);
        }
      } catch {
        // Never fail because of memory retrieval errors
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Extract and store memories from a conversation.
   */
  async extractMemories(userId: string, conversation: string): Promise<void> {
    try {
      await this.memoryService.extractAndStore(userId, conversation);
    } catch (error) {
      this.logger.warn('Failed to extract memories:', error);
    }
  }
}
