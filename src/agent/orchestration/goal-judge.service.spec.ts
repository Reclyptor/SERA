import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { GoalJudgeService } from './goal-judge.service';
import type { AgentGoal } from './orchestration.interfaces';

function createService(generateImpl: () => Promise<{ text: string }>) {
  const modelRouter = { generate: vi.fn(generateImpl) };
  const config = {
    get: vi.fn((key: string, fallback: string) => fallback),
  } as unknown as ConfigService;
  const service = new GoalJudgeService(modelRouter as never, config);
  return { service, modelRouter };
}

const GOAL = {
  userMessage: 'Review what needs attention.',
} as AgentGoal;

describe('GoalJudgeService', () => {
  it('parses a clean continue verdict with next step', async () => {
    const { service } = createService(() =>
      Promise.resolve({
        text: '{"verdict":"continue","nextStep":"draft the summary","reason":"more to do"}',
      }),
    );
    const v = await service.judge(GOAL, 'did part of it');
    expect(v.verdict).toBe('continue');
    expect(v.nextStep).toBe('draft the summary');
  });

  it('parses a verdict embedded in surrounding prose', async () => {
    const { service } = createService(() =>
      Promise.resolve({
        text: 'Here is my call:\n{"verdict":"done"}\nThat is all.',
      }),
    );
    expect((await service.judge(GOAL, 'x')).verdict).toBe('done');
  });

  it('defaults to done on unparseable output', async () => {
    const { service } = createService(() =>
      Promise.resolve({ text: 'I think it should keep going, probably.' }),
    );
    expect((await service.judge(GOAL, 'x')).verdict).toBe('done');
  });

  it('defaults to done on an unknown verdict value', async () => {
    const { service } = createService(() =>
      Promise.resolve({ text: '{"verdict":"maybe"}' }),
    );
    expect((await service.judge(GOAL, 'x')).verdict).toBe('done');
  });

  it('fails open to done when the model call throws', async () => {
    const { service } = createService(() =>
      Promise.reject(new Error('model down')),
    );
    expect((await service.judge(GOAL, 'x')).verdict).toBe('done');
  });

  it('respects the AUTONOMOUS_JUDGE_ENABLED flag', () => {
    const modelRouter = { generate: vi.fn() };
    const config = {
      get: vi.fn((_key: string, fallback: string) => fallback),
    } as unknown as ConfigService;
    expect(new GoalJudgeService(modelRouter as never, config).isEnabled()).toBe(
      true,
    );
  });
});
