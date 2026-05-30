/**
 * Local sparse-vector tokenizer for hybrid retrieval. Produces a
 * Qdrant `SparseVector` from a text input: lowercase, strip non-word
 * characters, split on whitespace, drop empties, hash each unique
 * token to a stable 32-bit positive integer index, and use the
 * token frequency as the value.
 *
 * Qdrant's collection-level `modifier: "idf"` on the sparse vector
 * applies inverse-document-frequency weighting at query time using
 * the live corpus, so we don't need to track IDF ourselves. The
 * tokenizer's job is just to produce a consistent (index, frequency)
 * encoding for the same token across writes and queries.
 *
 * Hash function: FNV-1a 32-bit. Deterministic, no deps, low collision
 * rate at the cardinality we care about (typical user corpora are far
 * below 2^32 distinct tokens).
 */

export interface SparseVector {
  indices: number[];
  values: number[];
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a32(token: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  // Force positive (Qdrant indices are unsigned). Shift right zero
  // converts to uint32 in the V8 representation.
  return hash >>> 0;
}

const TOKEN_SPLIT = /[^\p{L}\p{N}]+/u;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .split(TOKEN_SPLIT)
    .filter((t) => t.length > 1);
}

export function encodeSparse(text: string): SparseVector {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return { indices: [], values: [] };
  }

  const counts = new Map<number, number>();
  for (const token of tokens) {
    const idx = fnv1a32(token);
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }

  const indices: number[] = [];
  const values: number[] = [];
  for (const [idx, count] of counts) {
    indices.push(idx);
    values.push(count);
  }

  return { indices, values };
}
