import { z } from 'zod';
import type { MemoryService } from '../../memory/memory.service';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const parameters = z.object({
  tags: z
    .array(z.string())
    .optional()
    .describe(
      'Filter memories by tags. If empty/omitted, returns all memories.',
    ),
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of results'),
});

export class MemoryGetTool implements Tool<typeof parameters> {
  readonly name = 'memory_get';
  readonly parallelSafe = true;
  readonly description =
    'Retrieve stored memories. Get all memories or filter by tags.';
  readonly parameters = parameters;

  constructor(private readonly memoryService: MemoryService) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { tags, limit } = args;

    if (!context.userID) {
      return {
        success: false,
        error: 'User ID required for memory retrieval',
      };
    }

    try {
      const records = await this.memoryService.getAll(context.userID, {
        ...(tags && tags.length > 0 && { tags }),
      });

      const results = records.slice(0, limit).map((record) => ({
        id: record.id,
        content: record.content,
        tags: record.tags,
        createdAt: record.createdAt,
      }));

      return {
        success: true,
        result: { resultCount: results.length, results },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Memory retrieval failed',
      };
    }
  }

  renderResultSummary(
    args: z.infer<typeof parameters>,
    result: unknown,
  ): string {
    const filter =
      args.tags && args.tags.length > 0
        ? `tags=[${args.tags.join(',')}]`
        : 'all';
    if (result == null || typeof result !== 'object') {
      return `[memory_get] ${filter}`;
    }
    const r = result as { resultCount?: number };
    return `[memory_get] ${filter} -> ${r.resultCount ?? 0} memories`;
  }
}
