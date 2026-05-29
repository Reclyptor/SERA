import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ToolsRegistry } from '../../tools/tools.registry';

@Injectable()
export class ToolResultRendererService {
  constructor(
    @Inject(forwardRef(() => ToolsRegistry))
    private readonly registry: ToolsRegistry,
  ) {}

  render(toolName: string, args: unknown, result: unknown): string {
    const tool = this.registry.get(toolName);
    if (tool?.renderResultSummary) {
      try {
        return tool.renderResultSummary(args, result);
      } catch {
        // fall through to generic
      }
    }
    return this.renderFallback(toolName, args, result);
  }

  private renderFallback(
    toolName: string,
    args: unknown,
    result: unknown,
  ): string {
    const keyArgs = this.summarizeArgs(args);
    const size = this.estimateSize(result);
    const parts = [`[${toolName}]`];
    if (keyArgs) parts.push(keyArgs);
    if (size) parts.push(`(${size})`);
    return parts.join(' ');
  }

  private summarizeArgs(args: unknown): string {
    if (args == null || typeof args !== 'object' || Array.isArray(args)) {
      return '';
    }
    const entries = Object.entries(args as Record<string, unknown>);
    const parts: string[] = [];
    for (const [k, v] of entries.slice(0, 2)) {
      const sv = this.stringifyValue(v);
      if (!sv) continue;
      const trimmed = sv.length > 40 ? sv.slice(0, 37) + '...' : sv;
      parts.push(`${k}=${trimmed}`);
    }
    return parts.join(' ');
  }

  private stringifyValue(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      typeof v === 'bigint'
    ) {
      return String(v);
    }
    try {
      return JSON.stringify(v) ?? '';
    } catch {
      return '';
    }
  }

  private estimateSize(result: unknown): string {
    if (result == null) return '';
    let s: string;
    if (typeof result === 'string') {
      s = result;
    } else {
      try {
        s = JSON.stringify(result) ?? '';
      } catch {
        return '';
      }
    }
    if (s.length === 0) return '';
    const lines = s.split('\n').length;
    return `${s.length} chars, ${lines} lines`;
  }
}
