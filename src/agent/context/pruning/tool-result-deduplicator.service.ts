import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { ModelMessage } from 'ai';

const MIN_HASHABLE_LENGTH = 200;
const DUPLICATE_PLACEHOLDER =
  '[Duplicate tool output — same content as a more recent call]';

interface ToolResultPart {
  type: 'tool-result';
  toolCallId?: string;
  toolName?: string;
  output?: unknown;
  [key: string]: unknown;
}

function isToolResultPart(part: unknown): part is ToolResultPart {
  return (
    typeof part === 'object' &&
    part != null &&
    (part as { type?: unknown }).type === 'tool-result'
  );
}

@Injectable()
export class ToolResultDeduplicatorService {
  dedupe(messages: ModelMessage[]): {
    messages: ModelMessage[];
    duplicates: number;
  } {
    const seenHashes = new Set<string>();
    let duplicates = 0;

    const result: ModelMessage[] = [];
    // Walk newest-first so that the first time we see a hash, that copy is
    // the newest and stays intact; later (older) duplicates are replaced.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'tool' || !Array.isArray(msg.content)) {
        result.unshift(msg);
        continue;
      }

      let changed = false;
      const newContent = msg.content.map((part) => {
        if (!isToolResultPart(part)) return part;
        const outputStr = this.normalizeOutput(part.output);
        if (outputStr === DUPLICATE_PLACEHOLDER) return part;
        if (outputStr.length < MIN_HASHABLE_LENGTH) return part;
        const hash = createHash('sha256').update(outputStr).digest('hex');
        if (seenHashes.has(hash)) {
          duplicates += 1;
          changed = true;
          return { ...part, output: DUPLICATE_PLACEHOLDER };
        }
        seenHashes.add(hash);
        return part;
      });

      if (changed) {
        result.unshift({
          ...msg,
          content: newContent as unknown,
        } as ModelMessage);
      } else {
        result.unshift(msg);
      }
    }

    return { messages: result, duplicates };
  }

  private normalizeOutput(output: unknown): string {
    if (output == null) return '';
    if (typeof output === 'string') return output;
    if (
      typeof output === 'number' ||
      typeof output === 'boolean' ||
      typeof output === 'bigint'
    ) {
      return String(output);
    }
    try {
      return JSON.stringify(output) ?? '';
    } catch {
      return '';
    }
  }
}
