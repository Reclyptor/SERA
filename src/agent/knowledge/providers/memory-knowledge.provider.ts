import { MemoryService } from '../../memory/memory.service';
import type {
  KnowledgeProvider,
  KnowledgeQuery,
  KnowledgeResult,
} from '../knowledge.interface';

/**
 * Surfaces user memories as knowledge context. Constructed per-query
 * by `PromptBuilderService` with the active user ID so memory results
 * are scoped to the right tenant without leaking across users.
 */
export class MemoryKnowledgeProvider implements KnowledgeProvider {
  readonly name = 'memory';

  constructor(
    private readonly memoryService: MemoryService,
    private readonly userID: string,
  ) {}

  async search(query: KnowledgeQuery): Promise<KnowledgeResult[]> {
    const limit = query.limit ?? 5;
    const hits = await this.memoryService.search(this.userID, query.query, {
      limit,
    });

    return hits.map(({ record, effectiveScore }) => ({
      chunk: {
        documentID: record.id,
        chunkID: record.id,
        content: record.content,
        startOffset: 0,
        endOffset: record.content.length,
        metadata: {
          tags: record.tags,
          source: record.source,
          confidence: record.confidence,
          ...record.metadata,
        },
      },
      score: effectiveScore,
      document: {
        id: record.id,
        content: record.content,
        source: 'user-memory',
        metadata: record.metadata,
      },
    }));
  }
}
