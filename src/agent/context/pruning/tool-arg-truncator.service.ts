import { Injectable } from '@nestjs/common';
import type { ModelMessage } from 'ai';

const TRUNCATE_TRIGGER_LENGTH = 500;
const TRUNCATE_HEAD_LENGTH = 200;
const TRUNCATE_SUFFIX = '...[truncated]';

interface ToolCallPart {
  type: 'tool-call';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  [key: string]: unknown;
}

function isToolCallPart(part: unknown): part is ToolCallPart {
  return (
    typeof part === 'object' &&
    part != null &&
    (part as { type?: unknown }).type === 'tool-call'
  );
}

@Injectable()
export class ToolArgTruncatorService {
  truncate(messages: ModelMessage[]): {
    messages: ModelMessage[];
    truncated: number;
  } {
    let truncated = 0;
    const result = messages.map((msg): ModelMessage => {
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) {
        return msg;
      }
      let changed = false;
      const newContent = msg.content.map((part) => {
        if (!isToolCallPart(part)) return part;
        const { newArgs, didTruncate } = this.shrinkArgs(part.args);
        if (!didTruncate) return part;
        truncated += 1;
        changed = true;
        return { ...part, args: newArgs };
      });
      if (!changed) return msg;
      return { ...msg, content: newContent as unknown } as ModelMessage;
    });
    return { messages: result, truncated };
  }

  private shrinkArgs(args: unknown): {
    newArgs: unknown;
    didTruncate: boolean;
  } {
    if (typeof args === 'string') {
      // Stringified JSON form — parse, shrink, re-serialize so that downstream
      // providers still receive well-formed JSON. A mid-string slice would
      // corrupt the payload and produce non-retryable 400s.
      let parsed: unknown;
      try {
        parsed = JSON.parse(args);
      } catch {
        return { newArgs: args, didTruncate: false };
      }
      const { value, didTruncate } = this.shrinkValue(parsed);
      if (!didTruncate) return { newArgs: args, didTruncate: false };
      return { newArgs: JSON.stringify(value), didTruncate: true };
    }
    if (args && typeof args === 'object') {
      const { value, didTruncate } = this.shrinkValue(args);
      return { newArgs: value, didTruncate };
    }
    return { newArgs: args, didTruncate: false };
  }

  private shrinkValue(value: unknown): {
    value: unknown;
    didTruncate: boolean;
  } {
    if (typeof value === 'string') {
      if (value.length <= TRUNCATE_TRIGGER_LENGTH) {
        return { value, didTruncate: false };
      }
      return {
        value: value.slice(0, TRUNCATE_HEAD_LENGTH) + TRUNCATE_SUFFIX,
        didTruncate: true,
      };
    }
    if (Array.isArray(value)) {
      let didTruncate = false;
      const next = value.map((entry) => {
        const r = this.shrinkValue(entry);
        if (r.didTruncate) didTruncate = true;
        return r.value;
      });
      return { value: didTruncate ? next : value, didTruncate };
    }
    if (value && typeof value === 'object') {
      let didTruncate = false;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const r = this.shrinkValue(v);
        if (r.didTruncate) didTruncate = true;
        out[k] = r.value;
      }
      return { value: didTruncate ? out : value, didTruncate };
    }
    return { value, didTruncate: false };
  }
}
