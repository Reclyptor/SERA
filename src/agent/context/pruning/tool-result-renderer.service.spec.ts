import { describe, expect, it } from 'vitest';
import { ToolResultRendererService } from './tool-result-renderer.service';
import type { ToolsRegistry } from '../../tools/tools.registry';
import type { Tool } from '../../tools/tool.interface';

function makeRegistry(tools: Record<string, Tool>): ToolsRegistry {
  return {
    get: (name: string) => tools[name],
  } as unknown as ToolsRegistry;
}

describe('ToolResultRendererService', () => {
  it('uses a tool-provided renderResultSummary when present', () => {
    const readTool = {
      name: 'read',
      renderResultSummary: (args: { path: string }, result: unknown) =>
        `[read] ${args.path} (${typeof result === 'string' ? result.length : 0} chars)`,
    } as unknown as Tool;
    const renderer = new ToolResultRendererService(
      makeRegistry({ read: readTool }),
    );
    const summary = renderer.render(
      'read',
      { path: 'src/foo.ts' },
      'x'.repeat(1200),
    );
    expect(summary).toBe('[read] src/foo.ts (1200 chars)');
  });

  it('falls back to generic when no renderer is defined', () => {
    const renderer = new ToolResultRendererService(makeRegistry({}));
    const summary = renderer.render(
      'mystery_tool',
      { query: 'foo' },
      'output text',
    );
    expect(summary).toBe('[mystery_tool] query=foo (11 chars, 1 lines)');
  });

  it('falls back to generic when the tool renderer throws', () => {
    const broken = {
      name: 'broken',
      renderResultSummary: () => {
        throw new Error('boom');
      },
    } as unknown as Tool;
    const renderer = new ToolResultRendererService(makeRegistry({ broken }));
    const summary = renderer.render('broken', { x: 1 }, 'short');
    expect(summary.startsWith('[broken]')).toBe(true);
  });

  it('truncates long arg values in the generic fallback', () => {
    const renderer = new ToolResultRendererService(makeRegistry({}));
    const summary = renderer.render(
      'web_search',
      { query: 'this is a moderately long query string that should be cut' },
      'result',
    );
    expect(summary).toContain('query=this is a moderately long query');
    expect(summary).toContain('...');
  });

  it('handles missing result without crashing', () => {
    const renderer = new ToolResultRendererService(makeRegistry({}));
    const summary = renderer.render('memory_search', { query: 'x' }, undefined);
    expect(summary.startsWith('[memory_search]')).toBe(true);
  });
});
