import { describe, expect, it, vi } from 'vitest';
import { ManageIntentionAction } from './manage-intention.action';
import type { ActionExecutionContext } from '../action.interface';

function createAction(overrides: Record<string, unknown> = {}) {
  const service = {
    clampEarliest: vi.fn().mockResolvedValue(new Date('2026-07-14T12:00:00Z')),
    upsert: vi.fn().mockResolvedValue({ intentionID: 'int-1' }),
    act: vi.fn().mockResolvedValue({ intentionID: 'int-1' }),
    dismiss: vi.fn().mockResolvedValue({ intentionID: 'int-1' }),
    snooze: vi.fn().mockResolvedValue({ intentionID: 'int-1' }),
    ...overrides,
  };
  return { action: new ManageIntentionAction(service as never), service };
}

const ctx: ActionExecutionContext = {
  threadID: 'thread-1',
  runID: 'run-1',
  userID: 'user-1',
  agentID: 'agent-1',
};

describe('ManageIntentionAction', () => {
  it('creates an intention with a clamped due time and confidence 1', async () => {
    const { action, service } = createAction();
    const res = await action.execute(
      {
        operation: 'create',
        kind: 'event_check_in',
        suggestedText: 'How did the move go?',
      },
      ctx,
    );

    expect(service.clampEarliest).toHaveBeenCalled();
    const upsertArg = service.upsert.mock.calls[0][0];
    expect(upsertArg.agentID).toBe('agent-1');
    expect(upsertArg.confidence).toBe(1);
    expect(upsertArg.dedupeKey).toMatch(/^[a-f0-9]{64}$/);
    expect(res.success).toBe(true);
  });

  it('refuses to create without agent/user context', async () => {
    const { action, service } = createAction();
    const res = await action.execute(
      { operation: 'create', kind: 'open_loop', suggestedText: 'x' },
      { threadID: 't', runID: 'r' },
    );
    expect(res.success).toBe(false);
    expect(service.upsert).not.toHaveBeenCalled();
  });

  it('acts on a surfaced intention by id', async () => {
    const { action, service } = createAction();
    const res = await action.execute(
      { operation: 'act', intentionID: 'int-1' },
      ctx,
    );
    expect(service.act).toHaveBeenCalledWith('int-1');
    expect(res).toEqual({
      success: true,
      result: { intentionID: 'int-1', status: 'acted' },
    });
  });

  it('reports not-found when resolving an unknown intention', async () => {
    const { action } = createAction({
      dismiss: vi.fn().mockResolvedValue(null),
    });
    const res = await action.execute(
      { operation: 'dismiss', intentionID: 'missing' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });

  it('snoozes with a computed future timestamp', async () => {
    const { action, service } = createAction();
    await action.execute(
      { operation: 'snooze', intentionID: 'int-1', snoozeMinutes: 60 },
      ctx,
    );
    const [id, until] = service.snooze.mock.calls[0];
    expect(id).toBe('int-1');
    expect(until).toBeInstanceOf(Date);
  });
});
