import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

interface MemoryServiceLike {
  getAll(
    userID: string,
  ): Promise<
    Array<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      tags: string[];
      createdAt: Date;
    }>
  >;
  getByTags(
    userID: string,
    tags: string[],
  ): Promise<
    Array<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      tags: string[];
      createdAt: Date;
    }>
  >;
}

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

  constructor(private readonly memoryService: MemoryServiceLike) {}

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
      const memories =
        tags && tags.length > 0
          ? await this.memoryService.getByTags(context.userID, tags)
          : await this.memoryService.getAll(context.userID);

      const results = memories.slice(0, limit).map((m) => ({
        id: m.id,
        content: m.content,
        tags: m.tags,
        createdAt: m.createdAt,
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
}
