import { describe, expect, it, vi } from 'vitest';
import { AgentRouterService } from './agent-router.service';

interface BindingRow {
  agentID: string;
  bindingType: 'user' | 'channel' | 'default';
  bindingValue?: string;
  priority?: number;
  enabled?: boolean;
}

function createService(bindings: BindingRow[], enabledAgents: string[]) {
  const bindingModel = {
    find: vi.fn((filter: Record<string, unknown>) => ({
      sort: vi.fn(() => ({
        exec: vi.fn().mockResolvedValue(
          bindings
            .filter((b) => (b.enabled ?? true) === filter.enabled)
            .filter((b) => b.bindingType === filter.bindingType)
            .filter(
              (b) =>
                filter.bindingValue === undefined ||
                b.bindingValue === filter.bindingValue,
            )
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)),
        ),
      })),
    })),
  };
  const agentModel = {
    findOne: vi.fn((filter: { agentID: string; enabled?: boolean }) => ({
      exec: vi
        .fn()
        .mockResolvedValue(
          enabledAgents.includes(filter.agentID)
            ? { agentID: filter.agentID, enabled: true }
            : null,
        ),
    })),
  };
  return new AgentRouterService(bindingModel as never, agentModel as never);
}

describe('AgentRouterService.resolve', () => {
  it('routes to a user-bound enabled agent', async () => {
    const service = createService(
      [
        {
          agentID: 'agent-1',
          bindingType: 'user',
          bindingValue: 'user-1',
          priority: 0,
        },
      ],
      ['agent-1'],
    );

    await expect(service.resolve({ userID: 'user-1' })).resolves.toBe(
      'agent-1',
    );
  });

  it('skips a disabled agent and falls through to the next binding tier', async () => {
    const service = createService(
      [
        {
          agentID: 'disabled-agent',
          bindingType: 'user',
          bindingValue: 'user-1',
          priority: 10,
        },
        { agentID: 'default-agent', bindingType: 'default', priority: 0 },
      ],
      ['default-agent'],
    );

    await expect(service.resolve({ userID: 'user-1' })).resolves.toBe(
      'default-agent',
    );
  });

  it('returns null when no tier resolves to an enabled agent', async () => {
    const service = createService(
      [{ agentID: 'disabled-agent', bindingType: 'default', priority: 0 }],
      [],
    );

    await expect(service.resolve({ userID: 'user-1' })).resolves.toBeNull();
  });

  it('prefers the higher-priority binding among equal-type matches', async () => {
    const service = createService(
      [
        { agentID: 'low-prio', bindingType: 'default', priority: 1 },
        { agentID: 'high-prio', bindingType: 'default', priority: 10 },
      ],
      ['low-prio', 'high-prio'],
    );

    await expect(service.resolve({})).resolves.toBe('high-prio');
  });

  it('falls back from user binding to channel binding when user has no match', async () => {
    const service = createService(
      [
        {
          agentID: 'channel-agent',
          bindingType: 'channel',
          bindingValue: 'chat-1',
          priority: 0,
        },
      ],
      ['channel-agent'],
    );

    await expect(
      service.resolve({ userID: 'user-1', chatID: 'chat-1' }),
    ).resolves.toBe('channel-agent');
  });
});
