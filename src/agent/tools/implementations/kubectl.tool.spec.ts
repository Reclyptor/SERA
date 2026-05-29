import { describe, expect, it, vi } from 'vitest';
import { KubectlTool } from './kubectl.tool';
import type {
  ToolApprovalRequester,
  ToolApprovalResult,
} from '../tool-approval.service';

const ctx = { threadID: 't', runID: 'r', agentID: 'a' };

function approver(result: ToolApprovalResult): ToolApprovalRequester {
  return { requestApproval: vi.fn().mockResolvedValue(result) };
}

describe('KubectlTool — preflight', () => {
  it('surfaces an init error when KUBECONFIG is unset', async () => {
    const tool = new KubectlTool(null, null, approver({ status: 'approved' }));
    const res = await tool.execute({ operation: 'list', kind: 'Pod' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error ?? '').toMatch(/kubectl unavailable/);
    expect(res.error ?? '').toMatch(/KUBECONFIG/);
  });

  it('surfaces an init error when KUBECONFIG content is malformed', async () => {
    const tool = new KubectlTool(
      'not valid yaml: : :',
      null,
      approver({ status: 'approved' }),
    );
    const res = await tool.execute({ operation: 'list', kind: 'Pod' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error ?? '').toMatch(/kubectl unavailable/);
  });
});

describe('KubectlTool — approval gating', () => {
  // Pass a valid (but unreachable) kubeconfig YAML so construction
  // succeeds; the approval-gating paths short-circuit before any real
  // cluster I/O, so the unreachable server is never contacted.
  const STUB_KUBECONFIG = `
apiVersion: v1
kind: Config
clusters:
- name: stub
  cluster:
    server: https://127.0.0.1:1
    insecure-skip-tls-verify: true
users:
- name: stub
contexts:
- name: stub
  context:
    cluster: stub
    user: stub
current-context: stub
`;

  function newTool(approval: ToolApprovalResult): KubectlTool {
    return new KubectlTool(STUB_KUBECONFIG, null, approver(approval));
  }

  it('blocks delete_pod when approval is pending', async () => {
    const tool = newTool({
      status: 'pending',
      confirmationID: 'conf-1',
      fingerprint: 'fp',
    });
    const res = await tool.execute(
      { operation: 'delete_pod', name: 'web-0', namespace: 'default' },
      ctx,
    );
    expect(res.success).toBe(false);
    const r = res.result as { status?: string; confirmationID?: string };
    expect(r?.status).toBe('approval_required');
    expect(r?.confirmationID).toBe('conf-1');
  });

  it('rejects exec when operator says no', async () => {
    const tool = newTool({ status: 'rejected', feedback: 'denied' });
    const res = await tool.execute(
      {
        operation: 'exec',
        name: 'web-0',
        namespace: 'default',
        command: ['sh', '-c', 'whoami'],
      },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(res.error ?? '').toMatch(/denied/);
  });

  it('apply requires a manifest', async () => {
    const tool = newTool({ status: 'approved' });
    const res = await tool.execute({ operation: 'apply' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error ?? '').toMatch(/manifest/);
  });

  it('scale requires kind, name, and replicas', async () => {
    const tool = newTool({ status: 'approved' });
    const res = await tool.execute(
      { operation: 'scale', kind: 'Deployment' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(res.error ?? '').toMatch(/replicas/);
  });

  it('exec requires non-empty command', async () => {
    const tool = newTool({ status: 'approved' });
    const res = await tool.execute({ operation: 'exec', name: 'web-0' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error ?? '').toMatch(/command/);
  });
});
