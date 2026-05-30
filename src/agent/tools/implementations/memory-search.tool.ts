import { z } from 'zod';
import type { MemoryService } from '../../memory/memory.service';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const parameters = z.object({
  query: z.string().describe('Search query to find relevant memories'),
  limit: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe('Maximum number of results'),
  scoped: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Restrict search to memories from the current agent/thread; defaults to global user-scope',
    ),
});

export class MemorySearchTool implements Tool<typeof parameters> {
  readonly name = 'memory_search';
  readonly parallelSafe = true;
  readonly description =
    'Search through stored memories using hybrid semantic + keyword retrieval. Returns the most relevant memories matching the query.';
  readonly parameters = parameters;

  constructor(private readonly memoryService: MemoryService) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { query, limit, scoped } = args;

    if (!context.userID) {
      return { success: false, error: 'User ID required for memory search' };
    }

    try {
      const scope = scoped
        ? {
            ...(context.agentID && { agentID: context.agentID }),
            ...(context.threadID && { threadID: context.threadID }),
          }
        : undefined;

      const hits = await this.memoryService.search(context.userID, query, {
        limit,
        ...(scope && Object.keys(scope).length > 0 && { scope }),
      });

      const results = hits.map((hit) => ({
        id: hit.record.id,
        content: hit.record.content,
        tags: hit.record.tags,
        score: hit.effectiveScore,
        createdAt: hit.record.createdAt,
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

  renderResultSummary(
    args: z.infer<typeof parameters>,
    result: unknown,
  ): string {
    const q =
      args.query.length > 60 ? args.query.slice(0, 57) + '...' : args.query;
    if (result == null || typeof result !== 'object') {
      return `[memory_search] query='${q}'`;
    }
    const r = result as { resultCount?: number };
    return `[memory_search] query='${q}' -> ${r.resultCount ?? 0} memories`;
  }
}
