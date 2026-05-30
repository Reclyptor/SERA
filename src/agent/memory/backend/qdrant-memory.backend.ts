import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import type {
  AddMemoryInput,
  ListMemoryQuery,
  MemoryQuery,
  MemoryRecord,
  MemoryScope,
  MemoryScrollPage,
  MemorySearchHit,
  MemorySource,
} from '../memory.types';
import type { MemoryBackend } from './memory-backend.interface';
import { encodeSparse } from './sparse-tokenizer';

const DENSE_VECTOR_NAME = 'dense';
const SPARSE_VECTOR_NAME = 'sparse';

const DEFAULT_COLLECTION = 'sera_memories';
const DEFAULT_PREFETCH_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 10;

interface MemoryPayload {
  user_id: string;
  agent_id?: string;
  thread_id?: string;
  project_id?: string;
  content: string;
  tags: string[];
  source: MemorySource;
  confidence: number;
  created_at: string;
  last_read_at: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class QdrantMemoryBackend implements MemoryBackend, OnModuleInit {
  private readonly logger = new Logger(QdrantMemoryBackend.name);
  private readonly client: QdrantClient;
  private readonly openai: OpenAI;
  private readonly collection: string;
  private readonly embeddingModel: string;
  private readonly embeddingDimension: number;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {
    const qdrantUrl = this.configService.get<string>(
      'QDRANT_URL',
      'http://qdrant.qdrant.svc.cluster.local:6333',
    );
    const qdrantApiKey = this.configService.get<string>('QDRANT_API_KEY');

    this.client = new QdrantClient({
      url: qdrantUrl,
      ...(qdrantApiKey && { apiKey: qdrantApiKey }),
      checkCompatibility: false,
    });

    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });

    this.collection = this.configService.get<string>(
      'MEMORY_COLLECTION',
      DEFAULT_COLLECTION,
    );

    this.embeddingModel = this.configService.get<string>(
      'OPENAI_EMBEDDING_MODEL',
      'text-embedding-3-small',
    );
    this.embeddingDimension =
      this.embeddingModel === 'text-embedding-3-large' ? 3072 : 1536;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureCollection();
  }

  // ─── Schema bootstrap ───────────────────────────────────────────────

  private async ensureCollection(): Promise<void> {
    if (this.initialized) return;

    try {
      const existing = await this.client.getCollections();
      const exists = existing.collections.some(
        (c) => c.name === this.collection,
      );

      if (!exists) {
        await this.client.createCollection(this.collection, {
          vectors: {
            [DENSE_VECTOR_NAME]: {
              size: this.embeddingDimension,
              distance: 'Cosine',
            },
          },
          sparse_vectors: {
            [SPARSE_VECTOR_NAME]: {
              modifier: 'idf',
            },
          },
        });
        this.logger.log(
          `Created memory collection ${this.collection} (dense=${this.embeddingDimension}, sparse=idf)`,
        );
      }

      await this.ensurePayloadIndexes();
      this.initialized = true;
    } catch (err) {
      this.logger.error('Failed to ensure memory collection:', err);
      throw err;
    }
  }

  private async ensurePayloadIndexes(): Promise<void> {
    const indexes: Array<{
      field: string;
      schema: 'keyword' | 'float' | 'datetime';
    }> = [
      { field: 'user_id', schema: 'keyword' },
      { field: 'agent_id', schema: 'keyword' },
      { field: 'thread_id', schema: 'keyword' },
      { field: 'project_id', schema: 'keyword' },
      { field: 'confidence', schema: 'float' },
      { field: 'created_at', schema: 'datetime' },
      { field: 'last_read_at', schema: 'datetime' },
    ];

    for (const { field, schema } of indexes) {
      try {
        await this.client.createPayloadIndex(this.collection, {
          field_name: field,
          field_schema: schema,
          wait: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/exists|already/i.test(msg)) {
          this.logger.warn(
            `Payload index create for ${field} reported: ${msg}`,
          );
        }
      }
    }
  }

  // ─── Embeddings ─────────────────────────────────────────────────────

  private async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return response.data[0].embedding;
  }

  // ─── Filter builders ───────────────────────────────────────────────

  private scopeFilter(
    userID: string,
    scope?: MemoryScope,
    tags?: string[],
  ): Record<string, unknown> {
    const must: Array<Record<string, unknown>> = [
      { key: 'user_id', match: { value: userID } },
    ];

    if (scope?.agentID) {
      must.push({ key: 'agent_id', match: { value: scope.agentID } });
    }
    if (scope?.threadID) {
      must.push({ key: 'thread_id', match: { value: scope.threadID } });
    }
    if (scope?.projectID) {
      must.push({ key: 'project_id', match: { value: scope.projectID } });
    }
    if (tags && tags.length > 0) {
      must.push({ key: 'tags', match: { any: tags } });
    }

    return { must };
  }

  // ─── Add ───────────────────────────────────────────────────────────

  async add(userID: string, input: AddMemoryInput): Promise<MemoryRecord> {
    await this.ensureCollection();

    const now = new Date();
    const id = randomUUID();
    const denseVector = await this.embed(input.content);
    const sparseVector = encodeSparse(input.content);

    const payload: MemoryPayload = {
      user_id: userID,
      content: input.content,
      tags: input.tags ?? [],
      source: input.source ?? 'user-saved',
      confidence: input.confidence ?? 1.0,
      created_at: now.toISOString(),
      last_read_at: now.toISOString(),
      ...(input.scope?.agentID && { agent_id: input.scope.agentID }),
      ...(input.scope?.threadID && { thread_id: input.scope.threadID }),
      ...(input.scope?.projectID && { project_id: input.scope.projectID }),
      ...(input.metadata && { metadata: input.metadata }),
    };

    await this.client.upsert(this.collection, {
      wait: true,
      points: [
        {
          id,
          vector: {
            [DENSE_VECTOR_NAME]: denseVector,
            [SPARSE_VECTOR_NAME]: sparseVector,
          },
          payload: payload as unknown as Record<string, unknown>,
        },
      ],
    });

    return this.payloadToRecord(id, payload);
  }

  // ─── Hybrid search ─────────────────────────────────────────────────

  async hybridSearch(query: MemoryQuery): Promise<MemorySearchHit[]> {
    await this.ensureCollection();

    const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
    const prefetchLimit = query.prefetchLimit ?? DEFAULT_PREFETCH_LIMIT;
    const filter = this.scopeFilter(query.userID, query.scope, query.tags);

    const denseVector = await this.embed(query.query);
    const sparseVector = encodeSparse(query.query);

    let results;
    try {
      results = await this.client.query(this.collection, {
        prefetch: [
          {
            query: denseVector,
            using: DENSE_VECTOR_NAME,
            filter,
            limit: prefetchLimit,
          },
          {
            query: sparseVector,
            using: SPARSE_VECTOR_NAME,
            filter,
            limit: prefetchLimit,
          },
        ],
        query: { fusion: 'rrf' },
        filter,
        limit,
        with_payload: true,
      });
    } catch (err) {
      this.logger.error('Hybrid search failed:', err);
      return [];
    }

    return results.points.map((point) => {
      const payload = point.payload as unknown as MemoryPayload;
      const record = this.payloadToRecord(String(point.id), payload);
      return {
        record,
        rawScore: point.score ?? 0,
        effectiveScore: point.score ?? 0,
      };
    });
  }

  // ─── List ──────────────────────────────────────────────────────────

  async list(query: ListMemoryQuery): Promise<MemoryRecord[]> {
    await this.ensureCollection();

    const filter = this.scopeFilter(query.userID, query.scope, query.tags);
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const result = await this.client.scroll(this.collection, {
      filter,
      with_payload: true,
      limit: limit + offset,
    });

    const records = result.points
      .slice(offset)
      .map((point) =>
        this.payloadToRecord(
          String(point.id),
          point.payload as unknown as MemoryPayload,
        ),
      );

    records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return records;
  }

  // ─── Get by ID ─────────────────────────────────────────────────────

  async getByID(
    userID: string,
    memoryID: string,
  ): Promise<MemoryRecord | null> {
    await this.ensureCollection();

    const result = await this.client.retrieve(this.collection, {
      ids: [memoryID],
      with_payload: true,
    });

    const point = result[0];
    if (!point) return null;

    const payload = point.payload as unknown as MemoryPayload;
    if (payload.user_id !== userID) return null;

    return this.payloadToRecord(String(point.id), payload);
  }

  // ─── Delete ────────────────────────────────────────────────────────

  async delete(userID: string, memoryID: string): Promise<boolean> {
    await this.ensureCollection();

    const owned = await this.getByID(userID, memoryID);
    if (!owned) return false;

    await this.client.delete(this.collection, {
      wait: true,
      points: [memoryID],
    });
    return true;
  }

  async deleteMany(memoryIDs: string[]): Promise<void> {
    if (memoryIDs.length === 0) return;
    await this.ensureCollection();
    await this.client.delete(this.collection, {
      wait: true,
      points: memoryIDs,
    });
  }

  // ─── Touch (bump last_read_at) ─────────────────────────────────────

  async touch(memoryIDs: string[]): Promise<void> {
    if (memoryIDs.length === 0) return;
    try {
      await this.ensureCollection();
      const now = new Date().toISOString();
      await this.client.setPayload(this.collection, {
        payload: { last_read_at: now },
        points: memoryIDs,
        wait: false,
      });
    } catch (err) {
      this.logger.debug(
        `touch() failed (non-fatal): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ─── Update confidence (consolidator) ──────────────────────────────

  async updateConfidence(
    memoryID: string,
    confidence: number,
  ): Promise<void> {
    await this.ensureCollection();
    await this.client.setPayload(this.collection, {
      payload: { confidence },
      points: [memoryID],
      wait: false,
    });
  }

  // ─── Scroll (consolidator) ─────────────────────────────────────────

  async scroll(
    pageSize: number,
    cursor?: string | number,
  ): Promise<MemoryScrollPage> {
    await this.ensureCollection();

    const result = await this.client.scroll(this.collection, {
      with_payload: true,
      with_vector: false,
      limit: pageSize,
      ...(cursor !== undefined && { offset: cursor }),
    });

    const records = result.points.map((point) =>
      this.payloadToRecord(
        String(point.id),
        point.payload as unknown as MemoryPayload,
      ),
    );

    return {
      records,
      ...(result.next_page_offset != null && {
        nextCursor: result.next_page_offset as string | number,
      }),
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private payloadToRecord(id: string, payload: MemoryPayload): MemoryRecord {
    const scope: MemoryScope = {};
    if (payload.agent_id) scope.agentID = payload.agent_id;
    if (payload.thread_id) scope.threadID = payload.thread_id;
    if (payload.project_id) scope.projectID = payload.project_id;

    return {
      id,
      userID: payload.user_id,
      content: payload.content,
      tags: payload.tags ?? [],
      source: payload.source,
      confidence: payload.confidence,
      scope,
      metadata: payload.metadata ?? {},
      createdAt: new Date(payload.created_at),
      lastReadAt: new Date(payload.last_read_at ?? payload.created_at),
    };
  }
}
