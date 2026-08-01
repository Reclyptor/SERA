import { describe, it, expect, beforeEach } from 'vitest';
import { ActionsRegistry } from './actions.registry';
import type { BackendAction } from './action.interface';

const stub = (name: string) => ({ name }) as unknown as BackendAction;

describe('ActionsRegistry.size', () => {
  let registry: ActionsRegistry;

  beforeEach(() => {
    registry = new ActionsRegistry();
  });

  it('starts empty', () => {
    expect(registry.size).toBe(0);
  });

  it('tracks registrations', () => {
    registry.register(stub('save_memory'));
    registry.register(stub('search_memory'));
    expect(registry.size).toBe(2);
  });

  it('does not double-count a re-registered name', () => {
    registry.register(stub('save_memory'));
    registry.register(stub('save_memory'));
    expect(registry.size).toBe(1);
  });

  it('decrements on unregister', () => {
    registry.register(stub('save_memory'));
    registry.register(stub('search_memory'));
    registry.unregister('save_memory');
    expect(registry.size).toBe(1);
  });
});
