import type {
  AddMemoryInput,
  ListMemoryQuery,
  MemoryQuery,
  MemoryRecord,
  MemoryScrollPage,
  MemorySearchHit,
} from '../memory.types';

/**
 * Storage contract for the memory subsystem. The shipped implementation
 * is `QdrantMemoryBackend`; alternatives (Postgres+pgvector, in-memory
 * test double, federated multi-store) plug in here without rippling
 * through `MemoryService` or its consumers.
 *
 * Implementations MUST:
 *  - enforce `userID` isolation on every read/write/delete path,
 *  - return records with `effectiveScore` already populated from the
 *    backend's fusion stage (RRF for Qdrant) — the `MemoryScorer`
 *    refines it with decay + confidence afterward,
 *  - treat `touch()` as fire-and-forget from the caller's perspective
 *    (errors are logged but never thrown).
 */
export interface MemoryBackend {
  add(userID: string, input: AddMemoryInput): Promise<MemoryRecord>;

  /**
   * Hybrid retrieval: dense + sparse prefetches fused by the backend.
   * The returned `rawScore` is the fusion score; `effectiveScore`
   * starts as a copy of `rawScore` and is rewritten by the scorer.
   */
  hybridSearch(query: MemoryQuery): Promise<MemorySearchHit[]>;

  list(query: ListMemoryQuery): Promise<MemoryRecord[]>;

  getByID(userID: string, memoryID: string): Promise<MemoryRecord | null>;

  delete(userID: string, memoryID: string): Promise<boolean>;

  /**
   * Bump `last_read_at` on the given memory IDs. Fire-and-forget from
   * the caller's perspective — used by retrieval paths to keep
   * frequently-accessed memories alive under decay.
   */
  touch(memoryIDs: string[]): Promise<void>;

  /**
   * Paginated scroll for the consolidator. Implementations choose the
   * cursor representation; callers pass `nextCursor` back unchanged.
   */
  scroll(pageSize: number, cursor?: string | number): Promise<MemoryScrollPage>;

  deleteMany(memoryIDs: string[]): Promise<void>;

  updateConfidence(memoryID: string, confidence: number): Promise<void>;
}

export const MEMORY_BACKEND = Symbol('MemoryBackend');
