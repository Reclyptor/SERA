import { describe, it, expect, beforeEach } from 'vitest';
import { ToolsRegistry } from './tools.registry';
import type { Tool } from './tool.interface';

const stub = (name: string) => ({ name }) as unknown as Tool;

describe('ToolsRegistry.size', () => {
  let registry: ToolsRegistry;

  beforeEach(() => {
    registry = new ToolsRegistry();
  });

  it('starts empty', () => {
    expect(registry.size).toBe(0);
  });

  it('tracks registrations', () => {
    registry.register(stub('read'));
    registry.register(stub('write'));
    expect(registry.size).toBe(2);
  });

  // Registration is keyed by name, so re-registering the same tool replaces it
  // rather than adding. A hand-maintained count gets this wrong.
  it('does not double-count a re-registered name', () => {
    registry.register(stub('read'));
    registry.register(stub('read'));
    expect(registry.size).toBe(1);
  });

  it('decrements on unregister', () => {
    registry.register(stub('read'));
    registry.register(stub('write'));
    registry.unregister('read');
    expect(registry.size).toBe(1);
  });

  it('ignores unregister of an unknown name', () => {
    registry.register(stub('read'));
    registry.unregister('nope');
    expect(registry.size).toBe(1);
  });
});
