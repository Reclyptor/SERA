import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { QdrantClient } from '@qdrant/js-client-rest';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Memory, MemoryDocument } from './memory.schema';

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

  constructor(
    @InjectModel(Memory.name) private memoryModel: Model<MemoryDocument>,
    private readonly configService: ConfigService,
  ) {
    this.anthropic = new Anthropic();
    this.openai = new OpenAI();
    const qdrantApiKey = this.configService.get<string>('QDRANT_API_KEY');
    this.qdrant = new QdrantClient({
      url: this.configService.get<string>(
        'QDRANT_URL',
        'http://qdrant.qdrant.svc.cluster.local:6333',
      ),
      ...(qdrantApiKey && { apiKey: qdrantApiKey }),
    });
    this.embeddingModel = this.configService.get<string>(
      'OPENAI_EMBEDDING_MODEL',
      'text-embedding-3-small',
    );
    this.embeddingDimension =
      this.embeddingModel === 'text-embedding-3-large' ? 3072 : 1536;
  }

  private async ensureCollection(): Promise<void> {
    if (this.initialized) return;

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

      // Create payload index for userId filtering
      await this.qdrant.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'userId',
        field_schema: 'keyword',
      });
    }

    this.initialized = true;
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return response.data[0].embedding;
  }

  /**
   * Add a memory for a user
   */
  async add(
    userId: string,
    content: string,
    options: AddMemoryOptions = {},
  ): Promise<MemoryEntry> {
    const embedding = await this.generateEmbedding(content);

    // Persist to MongoDB (source of truth)
    const memory = await this.memoryModel.create({
      userId,
      content,
      embedding,
      metadata: options.metadata ?? {},
      tags: options.tags ?? [],
    });

    const memoryId = memory._id.toString();

    // Index in Qdrant for vector search
    await this.ensureCollection();
    await this.qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: memoryId,
          vector: embedding,
          payload: {
            userId,
            content,
            tags: options.tags ?? [],
            metadata: options.metadata ?? {},
            mongoId: memoryId,
            createdAt: memory.createdAt.toISOString(),
          },
        },
      ],
    });

    this.logger.debug(
      `Added memory for user ${userId}: ${content.slice(0, 50)}...`,
    );

    return {
      id: memoryId,
      content: memory.content,
      metadata: memory.metadata as Record<string, unknown>,
      tags: memory.tags,
      createdAt: memory.createdAt,
    };
  }

  /**
   * Search memories by semantic similarity via Qdrant
   */
  async search(
    userId: string,
    query: string,
    limit: number = 5,
    threshold: number = 0.7,
  ): Promise<MemoryEntry[]> {
    await this.ensureCollection();

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

    // Update access counts in MongoDB
    const mongoIds = results.map(
      (r) => (r.payload as Record<string, unknown>).mongoId as string,
    );
    await this.memoryModel.updateMany(
      { _id: { $in: mongoIds } },
      { $inc: { accessCount: 1 }, $set: { lastAccessedAt: new Date() } },
    );

    return results.map((hit) => {
      const payload = hit.payload as Record<string, unknown>;
      return {
        id: payload.mongoId as string,
        content: payload.content as string,
        metadata: (payload.metadata as Record<string, unknown>) ?? {},
        tags: (payload.tags as string[]) ?? [],
        createdAt: new Date(payload.createdAt as string),
        score: hit.score,
      };
    });
  }

  /**
   * Get all memories for a user
   */
  async getAll(userId: string): Promise<MemoryEntry[]> {
    const memories = await this.memoryModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .exec();

    return memories.map((memory) => ({
      id: memory._id.toString(),
      content: memory.content,
      metadata: memory.metadata as Record<string, unknown>,
      tags: memory.tags,
      createdAt: memory.createdAt,
    }));
  }

  /**
   * Get memories by tags
   */
  async getByTags(userId: string, tags: string[]): Promise<MemoryEntry[]> {
    const memories = await this.memoryModel
      .find({ userId, tags: { $in: tags } })
      .sort({ createdAt: -1 })
      .exec();

    return memories.map((memory) => ({
      id: memory._id.toString(),
      content: memory.content,
      metadata: memory.metadata as Record<string, unknown>,
      tags: memory.tags,
      createdAt: memory.createdAt,
    }));
  }

  /**
   * Update a memory
   */
  async update(
    userId: string,
    memoryId: string,
    content: string,
  ): Promise<MemoryEntry | null> {
    const embedding = await this.generateEmbedding(content);

    const memory = await this.memoryModel
      .findOneAndUpdate(
        { _id: memoryId, userId },
        { content, embedding },
        { new: true },
      )
      .exec();

    if (!memory) return null;

    // Update Qdrant vector
    await this.ensureCollection();
    await this.qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: memoryId,
          vector: embedding,
          payload: {
            userId,
            content,
            tags: memory.tags,
            metadata: memory.metadata,
            mongoId: memoryId,
            createdAt: memory.createdAt.toISOString(),
          },
        },
      ],
    });

    return {
      id: memory._id.toString(),
      content: memory.content,
      metadata: memory.metadata as Record<string, unknown>,
      tags: memory.tags,
      createdAt: memory.createdAt,
    };
  }

  /**
   * Delete a memory
   */
  async delete(userId: string, memoryId: string): Promise<boolean> {
    const result = await this.memoryModel
      .deleteOne({ _id: memoryId, userId })
      .exec();

    if (result.deletedCount > 0) {
      await this.ensureCollection();
      await this.qdrant.delete(COLLECTION_NAME, {
        wait: true,
        points: [memoryId],
      });
      return true;
    }

    return false;
  }

  /**
   * Delete all memories for a user
   */
  async deleteAll(userId: string): Promise<number> {
    const result = await this.memoryModel.deleteMany({ userId }).exec();

    if (result.deletedCount > 0) {
      await this.ensureCollection();
      await this.qdrant.delete(COLLECTION_NAME, {
        wait: true,
        filter: {
          must: [{ key: 'userId', match: { value: userId } }],
        },
      });
    }

    return result.deletedCount;
  }

  /**
   * Extract facts from a conversation and store as memories
   */
  async extractAndStore(
    userId: string,
    conversation: string,
  ): Promise<MemoryEntry[]> {
    const response = await this.anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
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

  /**
   * Get relevant memories for a query and format for context injection
   */
  async getContextForQuery(userId: string, query: string): Promise<string> {
    const memories = await this.search(userId, query, 5, 0.6);

    if (memories.length === 0) return '';

    const memoryLines = memories.map((m) => `- ${m.content}`).join('\n');
    return `Relevant information about this user:\n${memoryLines}`;
  }
}
