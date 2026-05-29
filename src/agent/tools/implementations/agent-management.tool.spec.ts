import { describe, expect, it, vi } from 'vitest';
import {
  AgentManagementTool,
  type AgentsServiceLike,
} from './agent-management.tool';
import type { ToolExecutionContext } from '../tool.interface';
import type {
  ToolApprovalRequester,
  ToolApprovalResult,
} from '../tool-approval.service';

function ctx(agentID = 'caller-agent'): ToolExecutionContext {
  return {
    threadID: 't1',
    runID: 'r1',
    agentID,
  };
}

function fakeService(
  overrides: Partial<AgentsServiceLike> = {},
): AgentsServiceLike {
  return {
    create: vi.fn().mockResolvedValue({
      agentID: 'frank',
      name: 'Frank',
      description: '',
      enabled: true,
    }),
    update: vi.fn().mockResolvedValue({
      agentID: 'frank',
      name: 'Frank',
      description: '',
      enabled: true,
    }),
    findByID: vi.fn().mockResolvedValue({
      agentID: 'frank',
      name: 'Frank',
      description: '',
      enabled: true,
      toolPolicy: { mode: 'deny', tools: [] },
    }),
    findAll: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function approver(result: ToolApprovalResult): ToolApprovalRequester {
  return { requestApproval: vi.fn().mockResolvedValue(result) };
}

describe('AgentManagementTool', () => {
  it('blocks self-mutation on update', async () => {
    const service = fakeService();
    const tool = new AgentManagementTool(service);
    const result = await tool.execute(
      { operation: 'update', agentID: 'caller-agent', name: 'Sneaky' },
      ctx('caller-agent'),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot modify the agent making this call/i);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('blocks self-mutation on delete', async () => {
    const service = fakeService();
    const tool = new AgentManagementTool(service);
    const result = await tool.execute(
      { operation: 'delete', agentID: 'caller-agent' },
      ctx('caller-agent'),
    );
    expect(result.success).toBe(false);
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('blocks deleting the default agent', async () => {
    const service = fakeService();
    const tool = new AgentManagementTool(service);
    const result = await tool.execute(
      { operation: 'delete', agentID: 'default' },
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/default agent cannot be delete/i);
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('blocks disabling the default agent', async () => {
    const service = fakeService();
    const tool = new AgentManagementTool(service);
    const result = await tool.execute(
      { operation: 'disable', agentID: 'default' },
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/default agent cannot be disable/i);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('requests approval when creating an agent with non-empty toolPolicy.tools', async () => {
    const service = fakeService();
    const approval = approver({ status: 'approved' });
    const tool = new AgentManagementTool(service, approval);
    const result = await tool.execute(
      {
        operation: 'create',
        agentID: 'frank',
        name: 'Frank',
        toolPolicy: { mode: 'allow', tools: ['exec', 'read'] },
      },
      ctx(),
    );
    expect(approval.requestApproval).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(service.create).toHaveBeenCalled();
  });

  it('does not request approval when creating an agent with empty toolPolicy', async () => {
    const service = fakeService();
    const approval = approver({ status: 'approved' });
    const tool = new AgentManagementTool(service, approval);
    const result = await tool.execute(
      { operation: 'create', agentID: 'frank', name: 'Frank' },
      ctx(),
    );
    expect(approval.requestApproval).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('requests approval on update when toolPolicy.tools differs from current', async () => {
    const service = fakeService({
      findByID: vi.fn().mockResolvedValue({
        agentID: 'frank',
        name: 'Frank',
        description: '',
        enabled: true,
        toolPolicy: { mode: 'allow', tools: ['read'] },
      }),
    });
    const approval = approver({ status: 'approved' });
    const tool = new AgentManagementTool(service, approval);
    await tool.execute(
      {
        operation: 'update',
        agentID: 'frank',
        toolPolicy: { mode: 'allow', tools: ['read', 'exec'] },
      },
      ctx(),
    );
    expect(approval.requestApproval).toHaveBeenCalledTimes(1);
  });

  it('does not request approval when toolPolicy is unchanged', async () => {
    const service = fakeService({
      findByID: vi.fn().mockResolvedValue({
        agentID: 'frank',
        name: 'Frank',
        description: '',
        enabled: true,
        toolPolicy: { mode: 'allow', tools: ['read', 'exec'] },
      }),
    });
    const approval = approver({ status: 'approved' });
    const tool = new AgentManagementTool(service, approval);
    await tool.execute(
      {
        operation: 'update',
        agentID: 'frank',
        toolPolicy: { mode: 'allow', tools: ['exec', 'read'] },
      },
      ctx(),
    );
    expect(approval.requestApproval).not.toHaveBeenCalled();
  });

  it('returns approval_required result when approver returns pending', async () => {
    const service = fakeService();
    const approval = approver({
      status: 'pending',
      confirmationID: 'conf-1',
      fingerprint: 'fp',
    });
    const tool = new AgentManagementTool(service, approval);
    const result = await tool.execute(
      {
        operation: 'create',
        agentID: 'frank',
        name: 'Frank',
        toolPolicy: { mode: 'allow', tools: ['exec'] },
      },
      ctx(),
    );
    expect(result.success).toBe(false);
    expect((result.result as { status: string }).status).toBe(
      'approval_required',
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it('refuses to execute when toolPolicy approval is rejected', async () => {
    const service = fakeService();
    const approval = approver({ status: 'rejected', feedback: 'no' });
    const tool = new AgentManagementTool(service, approval);
    const result = await tool.execute(
      {
        operation: 'create',
        agentID: 'frank',
        name: 'Frank',
        toolPolicy: { mode: 'allow', tools: ['exec'] },
      },
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rejected by operator/i);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rejects invalid agentID slugs on create', async () => {
    const service = fakeService();
    const tool = new AgentManagementTool(service);
    const result = await tool.execute(
      { operation: 'create', agentID: 'BadCaps!', name: 'X' },
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lowercase alphanumeric/i);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('lists agents', async () => {
    const service = fakeService({
      findAll: vi.fn().mockResolvedValue([
        { agentID: 'default', name: 'Default', description: '', enabled: true },
        { agentID: 'frank', name: 'Frank', description: '', enabled: false },
      ]),
    });
    const tool = new AgentManagementTool(service);
    const result = await tool.execute({ operation: 'list' }, ctx());
    expect(result.success).toBe(true);
    expect((result.result as unknown[]).length).toBe(2);
  });
});
