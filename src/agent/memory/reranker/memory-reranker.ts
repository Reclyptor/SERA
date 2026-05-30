import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModelRouterService } from '../../model/model-router.service';
import type { MemorySearchHit } from '../memory.types';

const DEFAULT_RERANK_MODEL = 'anthropic/claude-haiku-4-5';

/**
 * Optional final-stage rerank. Sends the top-N candidates and the
 * original query to a small LLM and asks for a ranked subset of the
 * candidate IDs. Used only for `getContextForQuery` (the per-session
 * frozen-context capture) — explicit `memory_search` tool calls skip
 * this to avoid per-call LLM cost.
 *
 * The reranker is fail-safe: on parse error, timeout, or any
 * exception from the model router, the pre-rerank order is returned
 * unchanged. This keeps the retrieval path tolerant of rerank
 * outages and preserves the prior behavior as a floor.
 */
@Injectable()
export class MemoryReranker {
  private readonly logger = new Logger(MemoryReranker.name);
  private readonly enabled: boolean;
  private readonly model: string;

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly configService: ConfigService,
  ) {
    this.enabled =
      this.configService.get<string>('MEMORY_RERANK_ENABLED', 'true') ===
      'true';
    this.model = this.configService.get<string>(
      'MEMORY_RERANK_MODEL',
      DEFAULT_RERANK_MODEL,
    );
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async rerank(
    query: string,
    hits: MemorySearchHit[],
    topK: number,
  ): Promise<MemorySearchHit[]> {
    if (!this.enabled || hits.length <= 1) {
      return hits.slice(0, topK);
    }

    const [provider, ...modelParts] = this.model.split('/');
    const modelID = modelParts.join('/');
    if (!provider || !modelID) {
      this.logger.warn(
        `Invalid MEMORY_RERANK_MODEL "${this.model}", skipping rerank`,
      );
      return hits.slice(0, topK);
    }

    const system =
      'You are a relevance grader. Given a user query and a list of candidate ' +
      'memories with IDs, return ONLY a JSON array of memory IDs in order of ' +
      'most-to-least relevant. Include only IDs you find relevant. No prose.';

    const candidateBlock = hits
      .map((hit, i) => `[${i + 1}] id=${hit.record.id}\n${hit.record.content}`)
      .join('\n\n');

    const userMessage = `Query: ${query}\n\nCandidates:\n${candidateBlock}\n\nReturn JSON array of relevant IDs, most relevant first.`;

    try {
      const result = await this.modelRouter.generate({
        messages: [{ role: 'user', content: userMessage }],
        system,
        options: { preferredProvider: provider, preferredModel: modelID },
        maxOutputTokens: 1024,
        temperature: 0,
      });

      const ranked = this.parseIDArray(result.text);
      if (!ranked || ranked.length === 0) {
        return hits.slice(0, topK);
      }

      const byID = new Map(hits.map((hit) => [hit.record.id, hit]));
      const reordered: MemorySearchHit[] = [];
      for (const id of ranked) {
        const hit = byID.get(id);
        if (hit && !reordered.includes(hit)) {
          reordered.push(hit);
          if (reordered.length >= topK) break;
        }
      }

      if (reordered.length === 0) {
        return hits.slice(0, topK);
      }
      return reordered;
    } catch (err) {
      this.logger.debug(
        `Rerank failed, returning un-reranked top-${topK}: ${err instanceof Error ? err.message : err}`,
      );
      return hits.slice(0, topK);
    }
  }

  private parseIDArray(text: string): string[] | null {
    const trimmed = text.trim();
    const candidates = [
      trimmed,
      this.extractFenced(trimmed),
      this.extractFirstArray(trimmed),
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (
          Array.isArray(parsed) &&
          parsed.every((x): x is string => typeof x === 'string')
        ) {
          return parsed;
        }
      } catch {
        // try next strategy
      }
    }
    return null;
  }

  private extractFenced(text: string): string | null {
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    return fence ? fence[1].trim() : null;
  }

  private extractFirstArray(text: string): string | null {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    return text.slice(start, end + 1);
  }
}
