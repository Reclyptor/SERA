import { describe, expect, it, vi } from 'vitest';
import { IntentionsService } from './intentions.service';

function leanResult<T>(value: T) {
  return {
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(value),
      }),
    }),
  };
}

describe('IntentionsService', () => {
  function create(heartbeatConfig: unknown) {
    const intentionModel = {
      findOneAndUpdate: vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) }),
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
      }),
    };
    const heartbeatModel = {
      findOne: vi.fn().mockReturnValue(leanResult(heartbeatConfig)),
    };
    const service = new IntentionsService(
      intentionModel as never,
      heartbeatModel as never,
    );
    return { service, intentionModel, heartbeatModel };
  }

  const NOW = new Date('2026-07-13T12:00:00Z');

  describe('clampEarliest (anti-echo)', () => {
    it('pushes a too-soon time out to now + heartbeat interval', async () => {
      const { service } = create({ intervalMinutes: 30 });
      const inferred = new Date(NOW.getTime() + 60_000); // 1 min out — too soon
      const result = await service.clampEarliest(inferred, 'agent-1', NOW);
      expect(result.getTime()).toBe(NOW.getTime() + 30 * 60_000);
    });

    it('keeps a comfortably-future time as-is', async () => {
      const { service } = create({ intervalMinutes: 30 });
      const inferred = new Date(NOW.getTime() + 6 * 60 * 60_000); // 6h out
      const result = await service.clampEarliest(inferred, 'agent-1', NOW);
      expect(result.getTime()).toBe(inferred.getTime());
    });

    it('uses the default interval when the agent has no heartbeat config', async () => {
      const { service } = create(null);
      const result = await service.clampEarliest(undefined, 'agent-1', NOW);
      expect(result.getTime()).toBe(NOW.getTime() + 30 * 60_000);
    });
  });

  describe('upsert (dedupe)', () => {
    it('filters on (agentID, dedupeKey) and never resets status on refresh', async () => {
      const { service, intentionModel } = create({ intervalMinutes: 30 });
      await service.upsert({
        agentID: 'agent-1',
        userID: 'user-1',
        kind: 'event_check_in',
        summary: 'interview tomorrow',
        suggestedText: 'How did the interview go?',
        confidence: 0.8,
        earliestAt: NOW,
        dedupeKey: 'abc123',
      });

      const [filter, update, options] =
        intentionModel.findOneAndUpdate.mock.calls[0];
      expect(filter).toEqual({ agentID: 'agent-1', dedupeKey: 'abc123' });
      expect(options).toMatchObject({ upsert: true, new: true });
      // status lives only in $setOnInsert — a refresh must not resurrect a
      // dismissed intention.
      expect(update.$set).not.toHaveProperty('status');
      expect(update.$setOnInsert.status).toBe('pending');
    });
  });

  describe('findDue', () => {
    it('queries pending/snoozed intentions that are due and not snoozed forward', async () => {
      const { service, intentionModel } = create({ intervalMinutes: 30 });
      await service.findDue('agent-1', NOW);
      const [query] = intentionModel.find.mock.calls[0];
      expect(query.agentID).toBe('agent-1');
      expect(query.status).toEqual({ $in: ['pending', 'snoozed'] });
      expect(query.earliestAt).toEqual({ $lte: NOW });
    });
  });
});
