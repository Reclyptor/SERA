export interface KnowledgeDocument {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  /**
   * Source of the document (e.g., file path, URL, database)
   */
  source?: string;
  /**
   * Optional embedding vector for semantic search
   */
  embedding?: number[];
}

export interface KnowledgeChunk {
  documentId: string;
  chunkId: string;
  content: string;
  /**
   * Start position in original document
   */
  startOffset: number;
  /**
   * End position in original document
   */
  endOffset: number;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

export interface KnowledgeQuery {
  query: string;
  /**
   * Maximum number of results to return
   */
  limit?: number;
  /**
   * Minimum similarity score (0-1) for results
   */
  minScore?: number;
  /**
   * Filter by metadata
   */
  filter?: Record<string, unknown>;
}

export interface KnowledgeResult {
  chunk: KnowledgeChunk;
  score: number;
  document?: KnowledgeDocument;
}

export interface ContextItem {
  /**
   * Unique identifier for this context item
   */
  id: string;
  /**
   * The actual content/data
   */
  content: string;
  /**
   * Type of context (e.g., 'document', 'state', 'readable')
   */
  type: 'document' | 'state' | 'readable' | 'custom';
  /**
   * Priority for inclusion in context window (higher = more important)
   */
  priority?: number;
  /**
   * Optional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Readable state from frontend (useCopilotReadable)
 */
export interface ReadableContext {
  id: string;
  description: string;
  value: unknown;
  categories?: string[];
}

export interface KnowledgeProvider {
  name: string;
  /**
   * Search for relevant knowledge
   */
  search(query: KnowledgeQuery): Promise<KnowledgeResult[]>;
  /**
   * Add a document to the knowledge base
   */
  addDocument?(document: Omit<KnowledgeDocument, 'id'>): Promise<KnowledgeDocument>;
  /**
   * Remove a document from the knowledge base
   */
  removeDocument?(documentId: string): Promise<boolean>;
}
