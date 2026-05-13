import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface ChatSearchLike {
  searchMessages(
    userID: string,
    query: string,
    opts?: { limit?: number },
  ): Promise<
    Array<{
      chatID: string;
      title: string;
      matches: Array<{ role: string; content: string; createdAt: Date }>;
      score: number;
    }>
  >;
}

const parameters = z.object({
  query: z
    .string()
    .describe('Search query to find relevant past conversations'),
  maxResults: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe('Maximum number of conversations to return'),
});

export class SessionSearchTool implements Tool<typeof parameters> {
  readonly name = 'session_search';
  readonly parallelSafe = true;
  readonly description =
    'Search through past conversations by keyword. Returns matching messages from previous sessions, useful for recalling context from earlier interactions.';
  readonly parameters = parameters;

  constructor(private readonly chatSearch: ChatSearchLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!context.userID) {
      return { success: false, error: 'User ID required for session search' };
    }

    try {
      const results = await this.chatSearch.searchMessages(
        context.userID,
        args.query,
        { limit: args.maxResults },
      );

      if (results.length === 0) {
        return {
          success: true,
          result: { query: args.query, resultCount: 0, results: [] },
        };
      }

      const formatted = results.map((r) => ({
        chatID: r.chatID,
        title: r.title,
        relevance: Math.round(r.score * 100) / 100,
        matchCount: r.matches.length,
        matches: r.matches,
      }));

      return {
        success: true,
        result: {
          query: args.query,
          resultCount: formatted.length,
          results: formatted,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Session search failed',
      };
    }
  }
}
