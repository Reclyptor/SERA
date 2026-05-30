import { z } from 'zod';
import type { MemoryService } from '../../memory/memory.service';
import type {
  BackendAction,
  ActionExecutionContext,
  ActionExecutionResult,
} from '../action.interface';

// --- Save Memory ---

const saveMemoryParams = z.object({
  content: z.string().describe('The fact or information to remember'),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      'Tags for categorization (e.g., "preference", "personal", "technical")',
    ),
});

export class SaveMemoryAction implements BackendAction<
  typeof saveMemoryParams
> {
  readonly name = 'save_memory';
  readonly description =
    'Save an important fact or preference about the user to long-term memory for future recall.';
  readonly parameters = saveMemoryParams;

  constructor(private readonly memoryService: MemoryService) {}

  async execute(
    args: z.infer<typeof saveMemoryParams>,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    if (!context.userID) {
      return { success: false, error: 'User ID required to save memory' };
    }

    const record = await this.memoryService.add(context.userID, {
      content: args.content,
      ...(args.tags && { tags: args.tags }),
      source: 'user-saved',
      confidence: 1.0,
      ...(context.threadID && { scope: { threadID: context.threadID } }),
      metadata: { runID: context.runID },
    });

    return {
      success: true,
      result: { memoryID: record.id, content: record.content },
    };
  }
}

// --- Search Memories ---

const searchMemoryParams = z.object({
  query: z.string().describe('Search query to find relevant memories'),
  limit: z.number().optional().default(5).describe('Maximum number of results'),
});

export class SearchMemoryAction implements BackendAction<
  typeof searchMemoryParams
> {
  readonly name = 'search_memory';
  readonly description =
    'Search long-term memory for information about the user. Use this to recall previously saved facts or preferences.';
  readonly parameters = searchMemoryParams;

  constructor(private readonly memoryService: MemoryService) {}

  async execute(
    args: z.infer<typeof searchMemoryParams>,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    if (!context.userID) {
      return { success: false, error: 'User ID required to search memories' };
    }

    const hits = await this.memoryService.search(context.userID, args.query, {
      limit: args.limit,
    });

    return {
      success: true,
      result: {
        count: hits.length,
        memories: hits.map((hit) => ({
          id: hit.record.id,
          content: hit.record.content,
          tags: hit.record.tags,
          relevance: hit.effectiveScore,
        })),
      },
    };
  }
}

// --- Delete Memory ---

const deleteMemoryParams = z.object({
  memoryID: z.string().describe('ID of the memory to delete'),
});

export class DeleteMemoryAction implements BackendAction<
  typeof deleteMemoryParams
> {
  readonly name = 'delete_memory';
  readonly description =
    'Delete a specific memory by ID. Use when the user asks to forget something.';
  readonly parameters = deleteMemoryParams;
  readonly requiresConfirmation = true;

  constructor(private readonly memoryService: MemoryService) {}

  async execute(
    args: z.infer<typeof deleteMemoryParams>,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    if (!context.userID) {
      return { success: false, error: 'User ID required to delete memory' };
    }

    const deleted = await this.memoryService.delete(
      context.userID,
      args.memoryID,
    );

    return {
      success: deleted,
      result: deleted ? { deleted: args.memoryID } : undefined,
      error: deleted ? undefined : 'Memory not found',
    };
  }
}
