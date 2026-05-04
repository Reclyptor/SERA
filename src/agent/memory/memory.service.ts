import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Memory, type MemoryItem } from 'mem0ai/oss';

export interface MemoryEntry {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  createdAt: Date;
  score?: number;
}

export interface AddMemoryOptions {
  metadata?: Record<string, unknown>;
  tags?: string[];
}

const COLLECTION_NAME = 'mem0_memories';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly mem0: Memory;

  constructor(private readonly configService: ConfigService) {
    const embeddingModel = this.configService.get<string>(
      'OPENAI_EMBEDDING_MODEL',
      'text-embedding-3-small',
    );
    const embeddingDims =
      embeddingModel === 'text-embedding-3-large' ? 3072 : 1536;

    const qdrantUrl = this.configService.get<string>(
      'QDRANT_URL',
      'http://qdrant.qdrant.svc.cluster.local:6333',
    );
    const qdrantApiKey = this.configService.get<string>('QDRANT_API_KEY');

    this.mem0 = new Memory({
      vectorStore: {
        provider: 'qdrant',
        config: {
          collectionName: COLLECTION_NAME,
          embeddingModelDims: embeddingDims,
          url: qdrantUrl,
          ...(qdrantApiKey && { apiKey: qdrantApiKey }),
        },
      },
      embedder: {
        provider: 'openai',
        config: { model: embeddingModel },
      },
      llm: {
        provider: 'anthropic',
        config: { model: 'claude-haiku-4-5' },
      },
      disableHistory: true,
    });
  }

  private toEntry(item: MemoryItem): MemoryEntry {
    const metadata = item.metadata ?? {};
    const tags = Array.isArray(metadata.tags) ? (metadata.tags as string[]) : [];
    return {
      id: item.id,
      content: item.memory,
      metadata,
      tags,
      createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
      ...(item.score !== undefined && { score: item.score }),
    };
  }

  async add(
    userID: string,
    content: string,
    options: AddMemoryOptions = {},
  ): Promise<MemoryEntry> {
    const metadata: Record<string, unknown> = { ...options.metadata };
    if (options.tags?.length) {
      metadata.tags = options.tags;
    }

    const result = await this.mem0.add(content, {
      userId: userID,
      metadata,
      infer: false,
    });

    const created = result.results[0];
    if (!created) {
      throw new Error('Mem0 returned no results from add');
    }

    this.logger.debug(
      `Added memory for user ${userID}: ${content.slice(0, 50)}...`,
    );

    return this.toEntry(created);
  }

  async search(
    userID: string,
    query: string,
    limit: number = 5,
    threshold: number = 0.7,
  ): Promise<MemoryEntry[]> {
    const result = await this.mem0.search(query, {
      topK: limit,
      filters: { user_id: userID },
      threshold,
    });

    return result.results.map((item) => this.toEntry(item));
  }

  async getAll(userID: string): Promise<MemoryEntry[]> {
    const result = await this.mem0.getAll({
      filters: { user_id: userID },
    });

    return result.results
      .map((item) => this.toEntry(item))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getByTags(userID: string, tags: string[]): Promise<MemoryEntry[]> {
    const all = await this.getAll(userID);
    return all.filter((entry) =>
      tags.every((tag) => entry.tags.includes(tag)),
    );
  }

  async update(
    userID: string,
    memoryID: string,
    content: string,
  ): Promise<MemoryEntry | null> {
    const existing = await this.mem0.get(memoryID);
    if (!existing) return null;

    await this.mem0.update(memoryID, content);

    const updated = await this.mem0.get(memoryID);
    return updated ? this.toEntry(updated) : null;
  }

  async delete(userID: string, memoryID: string): Promise<boolean> {
    const existing = await this.mem0.get(memoryID);
    if (!existing) return false;

    await this.mem0.delete(memoryID);
    return true;
  }

  async deleteAll(userID: string): Promise<number> {
    const all = await this.getAll(userID);
    const count = all.length;
    if (count === 0) return 0;

    await this.mem0.deleteAll({ userId: userID });
    return count;
  }

  async extractAndStore(
    userID: string,
    conversation: string,
  ): Promise<MemoryEntry[]> {
    try {
      const result = await this.mem0.add(conversation, {
        userId: userID,
        infer: true,
        metadata: { source: 'conversation_extraction', tags: ['auto-extracted'] },
      });

      const entries = result.results.map((item) => this.toEntry(item));

      this.logger.log(
        `Extracted ${entries.length} memories for user ${userID}`,
      );
      return entries;
    } catch (err) {
      this.logger.warn(
        'Memory extraction failed:',
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  }

  async getContextForQuery(userID: string, query: string): Promise<string> {
    const memories = await this.search(userID, query, 5, 0.6);

    if (memories.length === 0) return '';

    const memoryLines = memories.map((m) => `- ${m.content}`).join('\n');
    return `Relevant information about this user:\n${memoryLines}`;
  }
}
