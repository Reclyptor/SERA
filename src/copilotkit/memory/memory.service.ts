import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
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

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly anthropic: Anthropic;
  private readonly openai: OpenAI;
  private readonly embeddingModel: string;

  constructor(
    @InjectModel(Memory.name) private memoryModel: Model<MemoryDocument>,
    private readonly configService: ConfigService,
  ) {
    this.anthropic = new Anthropic();
    this.openai = new OpenAI();
    this.embeddingModel = this.configService.get<string>('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small');
  }

  /**
   * Generate embedding for text using OpenAI's embedding API
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });

    return response.data[0].embedding;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Add a memory for a user
   */
  async add(userId: string, content: string, options: AddMemoryOptions = {}): Promise<MemoryEntry> {
    const embedding = await this.generateEmbedding(content);
    
    const memory = await this.memoryModel.create({
      userId,
      content,
      embedding,
      metadata: options.metadata ?? {},
      tags: options.tags ?? [],
    });

    this.logger.debug(`Added memory for user ${userId}: ${content.slice(0, 50)}...`);

    return {
      id: memory._id.toString(),
      content: memory.content,
      metadata: memory.metadata as Record<string, unknown>,
      tags: memory.tags,
      createdAt: memory.createdAt,
    };
  }

  /**
   * Search memories by semantic similarity
   */
  async search(userId: string, query: string, limit: number = 5, threshold: number = 0.7): Promise<MemoryEntry[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    
    // Fetch all memories for user (in production, use MongoDB Atlas vector search)
    const memories = await this.memoryModel.find({ userId }).exec();
    
    // Calculate similarities and filter
    const results = memories
      .map((memory) => ({
        memory,
        score: this.cosineSimilarity(queryEmbedding, memory.embedding),
      }))
      .filter((result) => result.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Update access counts
    const memoryIds = results.map((r) => r.memory._id);
    await this.memoryModel.updateMany(
      { _id: { $in: memoryIds } },
      { $inc: { accessCount: 1 }, $set: { lastAccessedAt: new Date() } },
    );

    return results.map((result) => ({
      id: result.memory._id.toString(),
      content: result.memory.content,
      metadata: result.memory.metadata as Record<string, unknown>,
      tags: result.memory.tags,
      createdAt: result.memory.createdAt,
      score: result.score,
    }));
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
  async update(userId: string, memoryId: string, content: string): Promise<MemoryEntry | null> {
    const embedding = await this.generateEmbedding(content);
    
    const memory = await this.memoryModel.findOneAndUpdate(
      { _id: memoryId, userId },
      { content, embedding },
      { new: true },
    ).exec();

    if (!memory) return null;

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
    const result = await this.memoryModel.deleteOne({ _id: memoryId, userId }).exec();
    return result.deletedCount > 0;
  }

  /**
   * Delete all memories for a user
   */
  async deleteAll(userId: string): Promise<number> {
    const result = await this.memoryModel.deleteMany({ userId }).exec();
    return result.deletedCount;
  }

  /**
   * Extract facts from a conversation and store as memories
   */
  async extractAndStore(userId: string, conversation: string): Promise<MemoryEntry[]> {
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

      this.logger.log(`Extracted ${memories.length} memories for user ${userId}`);
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
