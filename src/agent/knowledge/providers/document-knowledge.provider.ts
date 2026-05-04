import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import type {
  KnowledgeProvider,
  KnowledgeDocument,
  KnowledgeQuery,
  KnowledgeResult,
} from '../knowledge.interface';

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;
const COLLECTION_NAME = 'knowledge_chunks';

export interface DocumentKnowledgeProviderOptions {
  qdrantUrl?: string;
  qdrantApiKey?: string;
  openaiApiKey?: string;
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  embeddingDimension?: number;
}

/**
 * Qdrant-backed document store with text chunking and OpenAI embedding search.
 * Documents are split into overlapping chunks, embedded, and stored in Qdrant
 * for fast approximate nearest-neighbor retrieval.
 */
export class DocumentKnowledgeProvider implements KnowledgeProvider {
  readonly name = 'documents';

  private readonly qdrant: QdrantClient;
  private readonly openai: OpenAI;
  private readonly embeddingModel: string;
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly embeddingDimension: number;
  private initialized = false;
  private qdrantAvailable = true;

  constructor(options?: DocumentKnowledgeProviderOptions) {
    this.qdrant = new QdrantClient({
      url: options?.qdrantUrl ?? 'http://qdrant.qdrant.svc.cluster.local:6333',
      ...(options?.qdrantApiKey && { apiKey: options.qdrantApiKey }),
      checkCompatibility: false,
    });
    this.openai = new OpenAI({
      ...(options?.openaiApiKey && { apiKey: options.openaiApiKey }),
    });
    this.embeddingModel = options?.embeddingModel ?? 'text-embedding-3-small';
    this.chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.chunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
    // text-embedding-3-small = 1536, text-embedding-3-large = 3072
    this.embeddingDimension = options?.embeddingDimension ?? 1536;
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
      }

      this.initialized = true;
      return true;
    } catch {
      this.qdrantAvailable = false;
      return false;
    }
  }

  async search(query: KnowledgeQuery): Promise<KnowledgeResult[]> {
    if (!(await this.ensureCollection())) return [];

    const limit = query.limit ?? 5;
    const minScore = query.minScore ?? 0.7;

    const queryEmbedding = await this.embed(query.query);

    const results = await this.qdrant.search(COLLECTION_NAME, {
      vector: queryEmbedding,
      limit,
      score_threshold: minScore,
      with_payload: true,
    });

    return results.map((hit) => {
      const p = hit.payload as Record<string, unknown>;
      const docID = typeof p.documentID === 'string' ? p.documentID : '';
      const content = typeof p.content === 'string' ? p.content : '';
      const startOffset = typeof p.startOffset === 'number' ? p.startOffset : 0;
      const endOffset = typeof p.endOffset === 'number' ? p.endOffset : 0;
      const metadata = (p.metadata && typeof p.metadata === 'object' ? p.metadata : {}) as Record<string, unknown>;
      return {
        chunk: {
          documentID: docID,
          chunkID: String(hit.id),
          content,
          startOffset,
          endOffset,
          metadata,
        },
        score: hit.score,
        document: p.document
          ? (p.document as KnowledgeDocument)
          : undefined,
      };
    });
  }

  async addDocument(
    doc: Omit<KnowledgeDocument, 'id'>,
  ): Promise<KnowledgeDocument> {
    if (!(await this.ensureCollection())) {
      throw new Error('Qdrant unavailable — cannot index documents');
    }

    const id = crypto.randomUUID();
    const document: KnowledgeDocument = { id, ...doc };

    const textChunks = this.splitIntoChunks(doc.content);
    const embeddings = await this.embedBatch(textChunks.map((c) => c.text));

    const points = textChunks.map((chunk, i) => ({
      id: crypto.randomUUID(),
      vector: embeddings[i],
      payload: {
        documentID: id,
        content: chunk.text,
        startOffset: chunk.start,
        endOffset: chunk.end,
        metadata: doc.metadata ?? {},
        source: doc.source,
        document: { id, source: doc.source, metadata: doc.metadata },
      },
    }));

    await this.qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points,
    });

    return document;
  }

  async removeDocument(documentID: string): Promise<boolean> {
    if (!(await this.ensureCollection())) return false;

    await this.qdrant.delete(COLLECTION_NAME, {
      wait: true,
      filter: {
        must: [
          {
            key: 'documentID',
            match: { value: documentID },
          },
        ],
      },
    });

    return true;
  }

  // ─── Chunking ───

  private splitIntoChunks(
    text: string,
  ): { text: string; start: number; end: number }[] {
    if (text.length <= this.chunkSize) {
      return [{ text, start: 0, end: text.length }];
    }

    const chunks: { text: string; start: number; end: number }[] = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + this.chunkSize, text.length);

      if (end < text.length) {
        const breakPoint = this.findBreakPoint(text, start, end);
        if (breakPoint > start) {
          end = breakPoint;
        }
      }

      const raw = text.slice(start, end);
      const trimmed = raw.trim();
      const leadingWS = raw.length - raw.trimStart().length;
      chunks.push({ text: trimmed, start: start + leadingWS, end: start + leadingWS + trimmed.length });
      start = end - this.chunkOverlap;
      if (start >= text.length) break;
    }

    return chunks.filter((c) => c.text.length > 0);
  }

  private findBreakPoint(text: string, start: number, end: number): number {
    const paragraphBreak = text.lastIndexOf('\n\n', end);
    if (paragraphBreak > start + this.chunkSize * 0.5) {
      return paragraphBreak + 2;
    }

    const sentenceBreak = text.lastIndexOf('. ', end);
    if (sentenceBreak > start + this.chunkSize * 0.5) {
      return sentenceBreak + 2;
    }

    const wordBreak = text.lastIndexOf(' ', end);
    if (wordBreak > start + this.chunkSize * 0.5) {
      return wordBreak + 1;
    }

    return end;
  }

  // ─── Embeddings ───

  private async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return response.data[0].embedding;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: texts,
    });

    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
