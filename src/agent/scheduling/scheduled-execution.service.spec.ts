import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ScheduledExecutionService } from './scheduled-execution.service';

function execResult<T>(value: T) {
  return { exec: vi.fn().mockResolvedValue(value) };
}

function execRejected(error: unknown) {
  return { exec: vi.fn().mockRejectedValue(error) };
}

describe('ScheduledExecutionService', () => {
  function createService(model: Record<string, Mock>) {
    const config = {
      get: vi.fn((key: string, fallback: string) => fallback),
    } as unknown as ConfigService;

    return new ScheduledExecutionService(model as never, config);
  }

  it('upserts one pending execution per scheduled occurrence', async () => {
    const scheduledFor = new Date('2026-05-16T12:00:00.000Z');
    const saved = { executionID: 'execution-1' };
    const model = {
      findOneAndUpdate: vi.fn().mockReturnValue(execResult(saved)),
    };
    const service = createService(model);

    await expect(
      service.ensurePending({
        kind: 'cron',
        targetID: 'job-1',
        agentID: 'agent-1',
        scheduledFor,
      }),
    ).resolves.toBe(saved);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { kind: 'cron', targetID: 'job-1', scheduledFor },
      {
        $setOnInsert: expect.objectContaining({
          kind: 'cron',
          targetID: 'job-1',
          agentID: 'agent-1',
          scheduledFor,
          status: 'pending',
          attempts: 0,
        }),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  });

  it('recovers from duplicate-key races by reading the existing execution', async () => {
    const scheduledFor = new Date('2026-05-16T12:00:00.000Z');
    const existing = { executionID: 'execution-1' };
    const model = {
      findOneAndUpdate: vi.fn().mockReturnValue(execRejected({ code: 11000 })),
      findOne: vi.fn().mockReturnValue(execResult(existing)),
    };
    const service = createService(model);

    await expect(
      service.ensurePending({
        kind: 'cron',
        targetID: 'job-1',
        agentID: 'agent-1',
        scheduledFor,
      }),
    ).resolves.toBe(existing);

    expect(model.findOne).toHaveBeenCalledWith({
      kind: 'cron',
      targetID: 'job-1',
      scheduledFor,
    });
  });

  it('claims only due pending or lease-expired executions atomically', async () => {
    const now = new Date('2026-05-16T12:00:00.000Z');
    const claimed = { executionID: 'execution-1' };
    const model = {
      findOneAndUpdate: vi.fn().mockReturnValue(execResult(claimed)),
    };
    const service = createService(model);

    await expect(service.claimNext('heartbeat', now)).resolves.toBe(claimed);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'heartbeat',
        scheduledFor: { $lte: now },
        status: { $in: ['pending', 'running'] },
        attempts: { $lt: 3 },
        $or: [
          { status: 'pending' },
          { leaseExpiresAt: { $lte: now } },
          { leaseExpiresAt: { $exists: false } },
        ],
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'running',
          leaseOwner: service.ownerID,
          startedAt: now,
        }),
        $inc: { attempts: 1 },
      }),
      { new: true, sort: { scheduledFor: 1, createdAt: 1 } },
    );
  });

  it('renews and clears leases only for the owning scheduler instance', async () => {
    const model = {
      updateOne: vi.fn().mockReturnValue(execResult({ modifiedCount: 1 })),
    };
    const service = createService(model);

    await expect(service.renewLease('execution-1')).resolves.toBe(true);
    await service.markTerminal('execution-1', 'completed');

    expect(model.updateOne).toHaveBeenNthCalledWith(
      1,
      {
        executionID: 'execution-1',
        status: 'running',
        leaseOwner: service.ownerID,
      },
      {
        $set: {
          leaseExpiresAt: expect.any(Date),
        },
      },
    );
    expect(model.updateOne).toHaveBeenNthCalledWith(
      2,
      {
        executionID: 'execution-1',
        leaseOwner: service.ownerID,
      },
      {
        $set: {
          status: 'completed',
          completedAt: expect.any(Date),
          error: '',
        },
        $unset: {
          leaseExpiresAt: '',
        },
      },
    );
  });
});
