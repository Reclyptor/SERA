/**
 * Shared types for the memory subsystem. Every public surface — service,
 * backend, scorer, reranker, consolidator, tools, actions, controller —
 * speaks in these. The interface is sized so a future Postgres / hybrid
 * backend can replace `QdrantMemoryBackend` without touching callers.
 *
 * See SPEC §13 for the architectural rationale.
 */

export type MemorySource = 'user-saved' | 'run-extracted' | 'imported';

/**
 * Optional scoping dimensions attached to every record. `userID` is the
 * tenant boundary and lives outside scope because it is mandatory; the
 * fields here are the secondary filters that callers may layer on at
 * query time to narrow recall to "this agent / this thread / this
 * project."
 */
export interface MemoryScope {
  agentID?: string;
  threadID?: string;
  projectID?: string;
}

export interface MemoryRecord {
  id: string;
  userID: string;
  content: string;
  tags: string[];
  source: MemorySource;
  confidence: number;
  scope: MemoryScope;
  metadata: Record<string, unknown>;
  createdAt: Date;
  lastReadAt: Date;
}

/**
 * A single retrieved candidate. `rawScore` is the score returned by the
 * backend's fusion step (RRF for Qdrant); `effectiveScore` is what the
 * scorer produced after applying recency decay and confidence weighting.
 * Callers should sort on `effectiveScore`.
 */
export interface MemorySearchHit {
  record: MemoryRecord;
  rawScore: number;
  effectiveScore: number;
}

export interface AddMemoryInput {
  content: string;
  tags?: string[];
  source?: MemorySource;
  confidence?: number;
  scope?: MemoryScope;
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  userID: string;
  query: string;
  scope?: MemoryScope;
  tags?: string[];
  limit?: number;
  prefetchLimit?: number;
}

export interface ListMemoryQuery {
  userID: string;
  scope?: MemoryScope;
  tags?: string[];
  limit?: number;
  offset?: number;
}

/**
 * Page of records yielded by the consolidator's full-collection scroll.
 * `nextCursor` is opaque to callers — pass it back verbatim to continue.
 */
export interface MemoryScrollPage {
  records: MemoryRecord[];
  nextCursor?: string | number;
}
