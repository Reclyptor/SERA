import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ProactiveGateService } from './proactive-gate.service';

type RedisMock = {
  zremrangebyscore: Mock;
  zcard: Mock;
  zadd: Mock;
  expire: Mock;
};

function createRedis(overrides: Partial<RedisMock> = {}): RedisMock {
  return {
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(0),
    zadd: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
}

function createModel(activeHours: unknown) {
  return {
    findOne: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(activeHours ? { activeHours } : null),
        }),
      }),
    }),
  };
}

function createService(opts: {
  redis?: RedisMock;
  activeHours?: unknown;
  config?: Record<string, string>;
}) {
  const redis = opts.redis ?? createRedis();
  const model = createModel(opts.activeHours ?? null);
  const values: Record<string, string> = {
    PROACTIVE_ACTIVE_HOURS_ENFORCED: 'true',
    PROACTIVE_MAX_PER_DAY: '6',
    ...opts.config,
  };
  const config = {
    get: vi.fn((key: string, fallback: string) => values[key] ?? fallback),
  } as unknown as ConfigService;

  const service = new ProactiveGateService(
    redis as never,
    model as never,
    config,
  );
  return { service, redis, model };
}

describe('ProactiveGateService', () => {
  const NOW = new Date('2026-07-13T12:00:00Z');

  it('blocks outside active hours without touching the rate limiter', async () => {
    const { service, redis } = createService({
      // 12:00 UTC is outside a 22–06 window
      activeHours: { start: 22, end: 6, timezone: 'UTC' },
    });

    const verdict = await service.check('agent-1', NOW);

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('active hours');
    expect(redis.zcard).not.toHaveBeenCalled();
  });

  it('allows within active hours and under the daily cap', async () => {
    const { service } = createService({
      activeHours: { start: 9, end: 17, timezone: 'UTC' },
      redis: createRedis({ zcard: vi.fn().mockResolvedValue(2) }),
    });

    await expect(service.check('agent-1', NOW)).resolves.toEqual({
      allowed: true,
    });
  });

  it('blocks when the rolling daily cap is reached', async () => {
    const { service } = createService({
      redis: createRedis({ zcard: vi.fn().mockResolvedValue(6) }),
    });

    const verdict = await service.check('agent-1', NOW);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('limit reached');
  });

  it('fails open when the rate limiter errors', async () => {
    const { service } = createService({
      redis: createRedis({
        zremrangebyscore: vi.fn().mockRejectedValue(new Error('redis down')),
      }),
    });

    await expect(service.check('agent-1', NOW)).resolves.toEqual({
      allowed: true,
    });
  });

  it('skips the cap entirely when max per day is zero', async () => {
    const { service, redis } = createService({
      config: { PROACTIVE_MAX_PER_DAY: '0' },
    });

    await expect(service.check('agent-1', NOW)).resolves.toEqual({
      allowed: true,
    });
    expect(redis.zcard).not.toHaveBeenCalled();
  });

  it('records a delivered message against the rolling window', async () => {
    const { service, redis } = createService({});

    await service.record('agent-1', NOW);

    expect(redis.zadd).toHaveBeenCalledWith(
      'sera:proactive:agent-1',
      NOW.getTime(),
      expect.stringContaining(`${NOW.getTime()}:`),
    );
    expect(redis.expire).toHaveBeenCalledWith('sera:proactive:agent-1', 86400);
  });
});
