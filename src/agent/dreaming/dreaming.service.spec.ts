import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { DreamingService } from './dreaming.service';

function acted(agentID: string, userID: string, summary: string) {
  return {
    agentID,
    userID,
    kind: 'care_check_in',
    summary,
    suggestedText: summary,
  };
}

function createService(opts: {
  actedSince?: unknown[];
  generate?: () => Promise<{ text: string }>;
  config?: Record<string, string>;
}) {
  const intentionsService = {
    expire: vi.fn().mockResolvedValue(0),
    findActedSince: vi.fn().mockResolvedValue(opts.actedSince ?? []),
  };
  const memoryService = {
    add: vi.fn().mockResolvedValue({ id: 'mem-1' }),
  };
  const modelRouter = {
    generate: vi.fn(opts.generate ?? (() => Promise.resolve({ text: '[]' }))),
  };
  const values: Record<string, string> = { ...opts.config };
  const config = {
    get: vi.fn((key: string, fallback: string) => values[key] ?? fallback),
  } as unknown as ConfigService;

  const service = new DreamingService(
    intentionsService as never,
    memoryService as never,
    modelRouter as never,
    config,
  );
  return { service, intentionsService, memoryService, modelRouter };
}

const NOW = new Date('2026-07-13T03:00:00Z');

describe('DreamingService', () => {
  it('expires stale intentions every cycle', async () => {
    const { service, intentionsService } = createService({});
    await service.runCycle(NOW);
    expect(intentionsService.expire).toHaveBeenCalledWith(NOW);
  });

  it('no-ops when nothing was acted on', async () => {
    const { service, modelRouter } = createService({ actedSince: [] });
    const summary = await service.runCycle(NOW);
    expect(summary).toEqual({ agents: 0, insights: 0 });
    expect(modelRouter.generate).not.toHaveBeenCalled();
  });

  it('groups acted intentions per agent+user and promotes distilled facts', async () => {
    const { service, memoryService, modelRouter } = createService({
      actedSince: [
        acted('a1', 'u1', 'moving apartments'),
        acted('a1', 'u1', 'new job'),
        acted('a2', 'u2', 'training for a marathon'),
      ],
      generate: () =>
        Promise.resolve({
          text: '["prefers concise updates","runs regularly"]',
        }),
    });

    const summary = await service.runCycle(NOW);

    expect(modelRouter.generate).toHaveBeenCalledTimes(2); // two groups
    expect(summary.agents).toBe(2);
    expect(summary.insights).toBe(4); // 2 facts x 2 groups
    const firstAdd = memoryService.add.mock.calls[0];
    expect(firstAdd[1]).toMatchObject({
      source: 'run-extracted',
      tags: ['dream'],
      scope: { agentID: 'a1' },
    });
  });

  it('caps insights per group at DREAMING_MAX_INSIGHTS', async () => {
    const { service, memoryService } = createService({
      actedSince: [acted('a1', 'u1', 'x')],
      config: { DREAMING_MAX_INSIGHTS: '1' },
      generate: () => Promise.resolve({ text: '["one","two","three"]' }),
    });
    await service.runCycle(NOW);
    expect(memoryService.add).toHaveBeenCalledTimes(1);
  });

  it('survives a model failure without throwing', async () => {
    const { service, memoryService } = createService({
      actedSince: [acted('a1', 'u1', 'x')],
      generate: () => Promise.reject(new Error('model down')),
    });
    await expect(service.runCycle(NOW)).resolves.toEqual({
      agents: 1,
      insights: 0,
    });
    expect(memoryService.add).not.toHaveBeenCalled();
  });
});
