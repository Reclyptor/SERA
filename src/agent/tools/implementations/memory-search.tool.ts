import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

interface MemoryServiceLike {
  search(
    userID: string,
    query: string,
    limit?: number,
    threshold?: number,
  ): Promise<
    Array<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      tags: string[];
      createdAt: Date;
      score?: number;
    }>
  >;
}

const parameters = z.object({
  query: z.string().describe('Search query to find relevant memories'),
  limit: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe('Maximum number of results'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.7)
    .describe('Minimum similarity score (0-1)'),
});

export class MemorySearchTool implements Tool<typeof parameters> {
  readonly name = 'memory_search';
  readonly parallelSafe = true;
  readonly description =
    'Search through stored memories using semantic similarity. Returns the most relevant memories matching the query.';
  readonly parameters = parameters;

  constructor(private readonly memoryService: MemoryServiceLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { query, limit, threshold } = args;

    if (!context.userID) {
      return { success: false, error: 'User ID required for memory search' };
    }

    try {
      const memories = await this.memoryService.search(
        context.userID,
        query,
        limit,
        threshold,
      );

      const results = memories.map((m) => ({
        id: m.id,
        content: m.content,
        tags: m.tags,
        score: m.score,
        createdAt: m.createdAt,
      }));

      return {
        success: true,
        result: { query, resultCount: results.length, results },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Memory search failed',
      };
    }
  }
}
