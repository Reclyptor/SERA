import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { ToolApprovalService } from './tool-approval.service';

interface MockConfirmation {
  id: string;
  actionName: string;
  status: 'pending' | 'approved' | 'rejected';
  args?: Record<string, unknown>;
  feedback?: string;
}

function fingerprintOf(
  actionName: string,
  args: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ actionName, args }))
    .digest('hex');
}

function setup(
  opts: { initialConfirmations?: MockConfirmation[]; addedID?: string } = {},
) {
  let pending: MockConfirmation[] = opts.initialConfirmations ?? [];
  const stateService = {
    getPendingConfirmations: vi
      .fn()
      .mockImplementation(() => Promise.resolve(pending)),
    removePendingConfirmation: vi
      .fn()
      .mockImplementation((_threadID: string, id: string) => {
        pending = pending.filter((c) => c.id !== id);
        return Promise.resolve(true);
      }),
    addPendingConfirmation: vi
      .fn()
      .mockResolvedValue(opts.addedID ?? 'new-conf'),
  };
  const eventEmitter = {
    emitEvent: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ToolApprovalService(
    stateService as never,
    eventEmitter as never,
  );
  return { service, stateService, eventEmitter, peek: () => pending };
}

const baseInput = {
  threadID: 'thread-1',
  runID: 'run-1',
  actionName: 'exec',
  args: { command: 'ls' },
  message: 'Run ls',
};

describe('ToolApprovalService.requestApproval', () => {
  it('emits approval.requested and returns pending for a fresh request', async () => {
    const { service, stateService, eventEmitter } = setup();

    const result = await service.requestApproval(baseInput);

    expect(result.status).toBe('pending');
    expect(stateService.addPendingConfirmation).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emitEvent).toHaveBeenCalledWith(
      'run-1',
      'thread-1',
      'approval.requested',
      expect.objectContaining({
        confirmationID: 'new-conf',
        actionName: 'exec',
      }),
    );
  });

  it('de-dupes against an existing pending entry with matching fingerprint', async () => {
    const fp = fingerprintOf('exec', { command: 'ls' });
    const { service, stateService, eventEmitter } = setup({
      initialConfirmations: [
        {
          id: 'existing',
          actionName: 'exec',
          status: 'pending',
          args: { command: 'ls', fingerprint: fp },
        },
      ],
    });

    const result = await service.requestApproval(baseInput);

    expect(result).toMatchObject({
      status: 'pending',
      confirmationID: 'existing',
    });
    expect(stateService.addPendingConfirmation).not.toHaveBeenCalled();
    expect(eventEmitter.emitEvent).not.toHaveBeenCalled();
  });

  it('consumes an approved confirmation and reports approved', async () => {
    const fp = fingerprintOf('exec', { command: 'ls' });
    const { service, stateService, peek } = setup({
      initialConfirmations: [
        {
          id: 'approved-1',
          actionName: 'exec',
          status: 'approved',
          args: { command: 'ls', fingerprint: fp },
        },
      ],
    });

    const result = await service.requestApproval(baseInput);

    expect(result).toEqual({ status: 'approved' });
    expect(stateService.removePendingConfirmation).toHaveBeenCalledWith(
      'thread-1',
      'approved-1',
    );
    expect(stateService.addPendingConfirmation).not.toHaveBeenCalled();
    expect(peek()).toHaveLength(0);
  });

  it('consumes a rejected confirmation and reports rejected with feedback', async () => {
    const fp = fingerprintOf('exec', { command: 'ls' });
    const { service, stateService } = setup({
      initialConfirmations: [
        {
          id: 'rejected-1',
          actionName: 'exec',
          status: 'rejected',
          feedback: 'too risky',
          args: { command: 'ls', fingerprint: fp },
        },
      ],
    });

    const result = await service.requestApproval(baseInput);

    expect(result).toEqual({ status: 'rejected', feedback: 'too risky' });
    expect(stateService.removePendingConfirmation).toHaveBeenCalledWith(
      'thread-1',
      'rejected-1',
    );
  });

  it('matches the same approval across different runIDs (fingerprint omits runID)', async () => {
    const fp = fingerprintOf('exec', { command: 'ls' });
    const { service } = setup({
      initialConfirmations: [
        {
          id: 'approved-1',
          actionName: 'exec',
          status: 'approved',
          args: { command: 'ls', fingerprint: fp },
        },
      ],
    });

    const result = await service.requestApproval({
      ...baseInput,
      runID: 'a-completely-different-run',
    });

    expect(result.status).toBe('approved');
  });

  it('treats different args as different approvals (no cross-call reuse)', async () => {
    const fp = fingerprintOf('exec', { command: 'ls' });
    const { service, stateService } = setup({
      initialConfirmations: [
        {
          id: 'approved-ls',
          actionName: 'exec',
          status: 'approved',
          args: { command: 'ls', fingerprint: fp },
        },
      ],
    });

    const result = await service.requestApproval({
      ...baseInput,
      args: { command: 'rm -rf /tmp/cache' },
    });

    // Different command must NOT match the previously-approved 'ls'.
    expect(result.status).toBe('pending');
    expect(stateService.removePendingConfirmation).not.toHaveBeenCalled();
  });
});
