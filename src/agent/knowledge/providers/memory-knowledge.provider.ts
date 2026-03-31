import { MemoryService } from '../../memory/memory.service';
import type {
  KnowledgeProvider,
  KnowledgeQuery,
  KnowledgeResult,
} from '../knowledge.interface';

/**
 * Surfaces user memories as knowledge context. Queries the MemoryService's
 * semantic search and maps results to the KnowledgeResult format.
 */
export class MemoryKnowledgeProvider implements KnowledgeProvider {
  readonly name = 'memory';

  constructor(
    private readonly memoryService: MemoryService,
    private readonly userId: string,
  ) {}

  async search(query: KnowledgeQuery): Promise<KnowledgeResult[]> {
    const limit = query.limit ?? 5;
    const minScore = query.minScore ?? 0.6;

    const memories = await this.memoryService.search(
      this.userId,
      query.query,
      limit,
      minScore,
    );

    return memories.map((memory) => ({
      chunk: {
        documentId: memory.id,
        chunkId: memory.id,
        content: memory.content,
        startOffset: 0,
        endOffset: memory.content.length,
        metadata: {
          tags: memory.tags,
          ...memory.metadata,
        },
      },
      score: memory.score ?? 0,
      document: {
        id: memory.id,
        content: memory.content,
        source: 'user-memory',
        metadata: memory.metadata,
      },
    }));
  }
}
