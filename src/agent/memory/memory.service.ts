import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

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

interface MemoryPayload {
  [key: string]: unknown;
  userId: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION_NAME = 'memories';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly anthropic: Anthropic;
  private readonly openai: OpenAI;
  private readonly qdrant: QdrantClient;
  private readonly embeddingModel: string;
  private readonly embeddingDimension: number;
  private initialized = false;
  private qdrantAvailable = true;

  constructor(private readonly configService: ConfigService) {
    this.anthropic = new Anthropic();
    this.openai = new OpenAI();
    const qdrantApiKey = this.configService.get<string>('QDRANT_API_KEY');
    this.qdrant = new QdrantClient({
      url: this.configService.get<string>(
        'QDRANT_URL',
        'http://qdrant.qdrant.svc.cluster.local:6333',
      ),
      ...(qdrantApiKey && { apiKey: qdrantApiKey }),
      checkCompatibility: false,
    });
    this.embeddingModel = this.configService.get<string>(
      'OPENAI_EMBEDDING_MODEL',
      'text-embedding-3-small',
    );
    this.embeddingDimension =
      this.embeddingModel === 'text-embedding-3-large' ? 3072 : 1536;
  }

  private async ensureCollection(): Promise<boolean> {
    if (!this.qdrantAvailable) return false;
    if (this.initialized) return true;

    try {
      const collections = await this.qdrant.getCollections();
      const exists = collections.collections.some(
        (c) => c.name === COLLECTION_NAME,
      );

      if (!exists) {
        await this.qdrant.createCollection(COLLECTION_NAME, {
          vectors: {
            size: this.embeddingDimension,
            distance: 'Cosine',
          },
        });

        await this.qdrant.createPayloadIndex(COLLECTION_NAME, {
          field_name: 'userId',
          field_schema: 'keyword',
        });
        await this.qdrant.createPayloadIndex(COLLECTION_NAME, {
          field_name: 'tags',
          field_schema: 'keyword',
        });
      }

      this.initialized = true;
      return true;
    } catch (error) {
      this.qdrantAvailable = false;
      this.logger.warn(
        'Qdrant unavailable — memory features disabled.',
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return response.data[0].embedding;
  }

  private toEntry(id: string, payload: MemoryPayload, score?: number): MemoryEntry {
    return {
      id,
      content: payload.content,
      metadata: payload.metadata ?? {},
      tags: payload.tags ?? [],
      createdAt: new Date(payload.createdAt),
      ...(score !== undefined && { score }),
    };
  }

  async add(
    userId: string,
    content: string,
    options: AddMemoryOptions = {},
  ): Promise<MemoryEntry> {
    if (!(await this.ensureCollection())) {
      throw new Error('Qdrant unavailable — cannot store memories');
    }

    const embedding = await this.generateEmbedding(content);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const payload: MemoryPayload = {
      userId,
      content,
      tags: options.tags ?? [],
      metadata: options.metadata ?? {},
      accessCount: 0,
      lastAccessedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: [{ id, vector: embedding, payload }],
    });

    this.logger.debug(
      `Added memory for user ${userId}: ${content.slice(0, 50)}...`,
    );

    return this.toEntry(id, payload);
  }

  async search(
    userId: string,
    query: string,
    limit: number = 5,
    threshold: number = 0.7,
  ): Promise<MemoryEntry[]> {
    if (!(await this.ensureCollection())) return [];

    const queryEmbedding = await this.generateEmbedding(query);

    const results = await this.qdrant.search(COLLECTION_NAME, {
      vector: queryEmbedding,
      limit,
      score_threshold: threshold,
      filter: {
        must: [{ key: 'userId', match: { value: userId } }],
      },
      with_payload: true,
    });

    if (results.length === 0) return [];

    // Update access tracking in the background
    const now = new Date().toISOString();
    for (const hit of results) {
      const p = hit.payload as MemoryPayload;
      this.qdrant
        .setPayload(COLLECTION_NAME, {
          payload: {
            accessCount: (p.accessCount ?? 0) + 1,
            lastAccessedAt: now,
          },
          points: [hit.id],
        })
        .catch(() => {});
    }

    return results.map((hit) =>
      this.toEntry(String(hit.id), hit.payload as MemoryPayload, hit.score),
    );
  }

  async getAll(userId: string): Promise<MemoryEntry[]> {
    if (!(await this.ensureCollection())) return [];

    const entries: MemoryEntry[] = [];
    let offset: string | number | Record<string, unknown> | undefined = undefined;

    // Paginate through all user memories via scroll
    while (true) {
      const page = await this.qdrant.scroll(COLLECTION_NAME, {
        filter: {
          must: [{ key: 'userId', match: { value: userId } }],
        },
        with_payload: true,
        limit: 100,
        offset,
      });

      for (const point of page.points) {
        entries.push(
          this.toEntry(String(point.id), point.payload as MemoryPayload),
        );
      }

      if (!page.next_page_offset) break;
      offset = page.next_page_offset;
    }

    return entries.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async getByTags(userId: string, tags: string[]): Promise<MemoryEntry[]> {
    if (!(await this.ensureCollection())) return [];

    const entries: MemoryEntry[] = [];
    let offset: string | number | Record<string, unknown> | undefined = undefined;

    while (true) {
      const page = await this.qdrant.scroll(COLLECTION_NAME, {
        filter: {
          must: [
            { key: 'userId', match: { value: userId } },
            ...tags.map((tag) => ({ key: 'tags', match: { value: tag } })),
          ],
        },
        with_payload: true,
        limit: 100,
        offset,
      });

      for (const point of page.points) {
        entries.push(
          this.toEntry(String(point.id), point.payload as MemoryPayload),
        );
      }

      if (!page.next_page_offset) break;
      offset = page.next_page_offset;
    }

    return entries.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async update(
    userId: string,
    memoryId: string,
    content: string,
  ): Promise<MemoryEntry | null> {
    if (!(await this.ensureCollection())) return null;

    // Fetch existing point to preserve payload fields
    const existing = await this.qdrant.retrieve(COLLECTION_NAME, {
      ids: [memoryId],
      with_payload: true,
    });

    if (existing.length === 0) return null;

    const oldPayload = existing[0].payload as MemoryPayload;
    if (oldPayload.userId !== userId) return null;

    const embedding = await this.generateEmbedding(content);
    const payload: MemoryPayload = {
      ...oldPayload,
      content,
      updatedAt: new Date().toISOString(),
    };

    await this.qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: [{ id: memoryId, vector: embedding, payload }],
    });

    return this.toEntry(memoryId, payload);
  }

  async delete(userId: string, memoryId: string): Promise<boolean> {
    if (!(await this.ensureCollection())) return false;

    // Verify ownership before deleting
    const existing = await this.qdrant.retrieve(COLLECTION_NAME, {
      ids: [memoryId],
      with_payload: true,
    });

    if (existing.length === 0) return false;
    if ((existing[0].payload as MemoryPayload).userId !== userId) return false;

    await this.qdrant.delete(COLLECTION_NAME, {
      wait: true,
      points: [memoryId],
    });

    return true;
  }

  async deleteAll(userId: string): Promise<number> {
    if (!(await this.ensureCollection())) return 0;

    // Count before deleting
    const count = await this.qdrant.count(COLLECTION_NAME, {
      filter: {
        must: [{ key: 'userId', match: { value: userId } }],
      },
      exact: true,
    });

    if (count.count === 0) return 0;

    await this.qdrant.delete(COLLECTION_NAME, {
      wait: true,
      filter: {
        must: [{ key: 'userId', match: { value: userId } }],
      },
    });

    return count.count;
  }

  async extractAndStore(
    userId: string,
    conversation: string,
  ): Promise<MemoryEntry[]> {
    const response = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Extract important facts, preferences, and information about the user from this conversation that would be useful to remember for future interactions. Return ONLY a JSON array of strings, each being a distinct fact. If no memorable facts, return an empty array [].

Conversation:
${conversation}

Examples of good facts to extract:
- "User prefers dark mode"
- "User's name is John"
- "User works as a software engineer"
- "User is learning Spanish"

Return only the JSON array, nothing else:`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return [];

    try {
      const facts = JSON.parse(textBlock.text) as string[];
      const memories: MemoryEntry[] = [];

      for (const fact of facts) {
        if (fact && fact.trim()) {
          const memory = await this.add(userId, fact.trim(), {
            metadata: { source: 'conversation_extraction' },
            tags: ['auto-extracted'],
          });
          memories.push(memory);
        }
      }

      this.logger.log(
        `Extracted ${memories.length} memories for user ${userId}`,
      );
      return memories;
    } catch {
      this.logger.warn('Failed to parse extracted facts');
      return [];
    }
  }

  async getContextForQuery(userId: string, query: string): Promise<string> {
    const memories = await this.search(userId, query, 5, 0.6);

    if (memories.length === 0) return '';

    const memoryLines = memories.map((m) => `- ${m.content}`).join('\n');
    return `Relevant information about this user:\n${memoryLines}`;
  }
}
