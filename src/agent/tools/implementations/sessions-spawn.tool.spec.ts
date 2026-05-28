import { describe, expect, it, vi } from 'vitest';
import { SessionsSpawnTool } from './sessions-spawn.tool';

function createTool(opts?: {
  agents?: Record<string, { agentID: string; enabled: boolean }>;
  routerResolves?: string | null;
}) {
  const agents = opts?.agents ?? {
    'agent-ok': { agentID: 'agent-ok', enabled: true },
    'agent-off': { agentID: 'agent-off', enabled: false },
  };

  const orchestrator = {
    executeGoal: vi.fn().mockResolvedValue(undefined),
  };
  const router = {
    resolve: vi.fn().mockResolvedValue(opts?.routerResolves ?? 'agent-ok'),
  };
  const runReader = {
    getRunResponse: vi
      .fn()
      .mockResolvedValue({ status: 'completed', response: 'done' }),
  };
  const agentsService = {
    findByID: vi.fn((id: string) => Promise.resolve(agents[id] ?? null)),
  };

  const tool = new SessionsSpawnTool(
    orchestrator,
    router,
    runReader,
    agentsService,
  );

  return { tool, orchestrator, router, runReader, agentsService };
}

const ctx = (overrides: Record<string, unknown> = {}) => ({
  threadID: 'parent-thread',
  runID: 'parent-run',
  agentID: 'parent-agent',
  ...overrides,
});

describe('SessionsSpawnTool delegation depth', () => {
  it('rejects spawns at or above MAX_DELEGATION_DEPTH', async () => {
    const { tool, orchestrator } = createTool();

    const result = await tool.execute(
      { action: 'navigate' as never, goal: 'do work', agentID: 'agent-ok' },
      ctx({ delegationDepth: 2 }),
    );

    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/Delegation depth/i);
    expect(orchestrator.executeGoal).not.toHaveBeenCalled();
  });

  it('propagates delegationDepth+1 to the spawned run', async () => {
    const { tool, orchestrator } = createTool();

    await tool.execute(
      { goal: 'do work', agentID: 'agent-ok', waitForResult: false } as never,
      ctx({ delegationDepth: 1 }),
    );

    expect(orchestrator.executeGoal).toHaveBeenCalledWith(
      expect.objectContaining({ delegationDepth: 2 }),
      expect.anything(),
    );
  });
});

describe('SessionsSpawnTool agentID validation', () => {
  it('rejects spawns for unknown agentID', async () => {
    const { tool, orchestrator } = createTool();

    const result = await tool.execute(
      { goal: 'do work', agentID: 'agent-nope' } as never,
      ctx(),
    );

    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/not found/i);
    expect(orchestrator.executeGoal).not.toHaveBeenCalled();
  });

  it('rejects spawns for disabled agents', async () => {
    const { tool, orchestrator } = createTool();

    const result = await tool.execute(
      { goal: 'do work', agentID: 'agent-off' } as never,
      ctx(),
    );

    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/disabled/i);
    expect(orchestrator.executeGoal).not.toHaveBeenCalled();
  });

  it('allows spawns for valid enabled agents', async () => {
    const { tool, orchestrator } = createTool();

    const result = await tool.execute(
      { goal: 'do work', agentID: 'agent-ok' } as never,
      ctx(),
    );

    expect(result.success).toBe(true);
    expect(orchestrator.executeGoal).toHaveBeenCalledTimes(1);
  });
});

describe('SessionsSpawnTool batch agent validation', () => {
  it('marks tasks routed to invalid agents as failed without spawning', async () => {
    const { tool, orchestrator } = createTool();

    const result = await tool.execute(
      {
        tasks: [
          { goal: 'task-a', agentID: 'agent-ok' },
          { goal: 'task-b', agentID: 'agent-off' },
        ],
        timeoutMs: 100,
      } as never,
      ctx(),
    );

    expect(result.success).toBe(true);
    const tasks = (result.result as { tasks: { status: string }[] }).tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.status === 'failed')).toBeDefined();
    // executeGoal called only for the valid agent
    expect(orchestrator.executeGoal).toHaveBeenCalledTimes(1);
  });
});
