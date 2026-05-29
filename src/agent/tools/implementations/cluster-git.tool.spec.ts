import { describe, expect, it, vi } from 'vitest';
import { ClusterGitTool } from './cluster-git.tool';
import type {
  GitHubFile,
  GitHubHttpClient,
} from '../../../github/github-http-client.service';
import type {
  ToolApprovalRequester,
  ToolApprovalResult,
} from '../tool-approval.service';

const ctx = { threadID: 't', runID: 'r', agentID: 'a' };

function buildHttpClient(
  overrides: Partial<GitHubHttpClient> = {},
): GitHubHttpClient {
  const base = {
    enabled: true,
    fetchTree: vi.fn(),
    fetchFile: vi.fn(),
    putFile: vi.fn(),
    deleteFile: vi.fn(),
    listCommits: vi.fn(),
    getHeadSha: vi.fn(),
  };
  return { ...base, ...overrides } as unknown as GitHubHttpClient;
}

function approver(result: ToolApprovalResult): ToolApprovalRequester {
  return { requestApproval: vi.fn().mockResolvedValue(result) };
}

describe('ClusterGitTool — preflight', () => {
  it('fails when GITHUB_PAT is missing', async () => {
    const tool = new ClusterGitTool(
      buildHttpClient({ enabled: false }),
      'Reclyptor/cluster',
      'master',
      approver({ status: 'approved' }),
    );
    const res = await tool.execute({ operation: 'list_files' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error ?? '').toMatch(/GITHUB_PAT/);
  });

  it('fails when CLUSTER_REPO is missing', async () => {
    const tool = new ClusterGitTool(
      buildHttpClient(),
      null,
      'master',
      approver({ status: 'approved' }),
    );
    const res = await tool.execute({ operation: 'list_files' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error ?? '').toMatch(/CLUSTER_REPO/);
  });
});

describe('ClusterGitTool — read ops', () => {
  it('list_files returns truncated entries', async () => {
    const http = buildHttpClient({
      fetchTree: vi.fn().mockResolvedValue([
        { path: 'a/b.yaml', sha: 's1', type: 'blob' },
        { path: 'a/c.yaml', sha: 's2', type: 'blob' },
        { path: 'd/e.yaml', sha: 's3', type: 'blob' },
      ]),
    });
    const tool = new ClusterGitTool(http, 'Reclyptor/cluster', 'master');
    const res = await tool.execute(
      { operation: 'list_files', pathPrefix: 'a/' },
      ctx,
    );
    expect(res.success).toBe(true);
    const r = res.result as { count: number; files: Array<{ path: string }> };
    expect(r.count).toBe(2);
    expect(r.files.map((f) => f.path)).toEqual(['a/b.yaml', 'a/c.yaml']);
  });

  it('read_file requires a path', async () => {
    const tool = new ClusterGitTool(buildHttpClient(), 'r', 'master');
    const res = await tool.execute({ operation: 'read_file' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error ?? '').toMatch(/path/);
  });

  it('read_file returns file content', async () => {
    const fetchFile = vi.fn().mockResolvedValue({
      content: 'apiVersion: v1\nkind: Pod',
      sha: 'abc',
      path: 'pods/test.yaml',
    } satisfies GitHubFile);
    const http = buildHttpClient({ fetchFile });
    const tool = new ClusterGitTool(http, 'r', 'master');
    const res = await tool.execute(
      { operation: 'read_file', path: 'pods/test.yaml' },
      ctx,
    );
    expect(res.success).toBe(true);
    expect(fetchFile).toHaveBeenCalledWith('r', 'pods/test.yaml', 'master');
  });
});

describe('ClusterGitTool — write gating', () => {
  it('returns pending result and does NOT call putFile when approval is pending', async () => {
    const putFile = vi.fn().mockResolvedValue('newsha');
    const http = buildHttpClient({ putFile });
    const tool = new ClusterGitTool(
      http,
      'r',
      'master',
      approver({
        status: 'pending',
        confirmationID: 'conf-1',
        fingerprint: 'fp',
      }),
    );
    const res = await tool.execute(
      { operation: 'write_file', path: 'p.yaml', content: 'x' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(putFile).not.toHaveBeenCalled();
    const r = res.result as { status?: string; confirmationID?: string };
    expect(r.status).toBe('approval_required');
    expect(r.confirmationID).toBe('conf-1');
  });

  it('proceeds through to putFile when approval is approved', async () => {
    const fetchFile = vi.fn().mockRejectedValue(new Error('not found'));
    const putFile = vi.fn().mockResolvedValue('newsha');
    const http = buildHttpClient({ fetchFile, putFile });
    const tool = new ClusterGitTool(
      http,
      'r',
      'master',
      approver({ status: 'approved' }),
    );
    const res = await tool.execute(
      {
        operation: 'write_file',
        path: 'new.yaml',
        content: 'apiVersion: v1',
        message: 'add resource',
      },
      ctx,
    );
    expect(res.success).toBe(true);
    expect(putFile).toHaveBeenCalledWith(
      'r',
      'new.yaml',
      'apiVersion: v1',
      undefined,
      'add resource',
      'master',
    );
    const r = res.result as { operation: string; sha: string };
    expect(r.operation).toBe('created');
    expect(r.sha).toBe('newsha');
  });

  it('rejects when operator says no', async () => {
    const deleteFile = vi.fn();
    const http = buildHttpClient({ putFile: vi.fn(), deleteFile });
    const tool = new ClusterGitTool(
      http,
      'r',
      'master',
      approver({ status: 'rejected', feedback: 'too risky' }),
    );
    const res = await tool.execute(
      { operation: 'delete_file', path: 'old.yaml' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(res.error ?? '').toMatch(/too risky/);
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
