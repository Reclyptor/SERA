import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { SandboxRunnerService } from './sandbox-runner.service';
import type { SandboxContext } from '../tools/tool.interface';

const config = (url?: string) =>
  ({ get: () => url }) as unknown as ConfigService;

const sandbox: SandboxContext = {
  image: 'node:24-alpine',
  memoryMb: 256,
  cpuShares: 1024,
  networkEnabled: false,
  envVars: { FOO: 'bar' },
};

const options = {
  command: 'echo hi',
  workspaceDir: '/workspace',
  agentID: 'default',
  sandbox,
};

describe('SandboxRunnerService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to pod-local loopback', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    });
    await new SandboxRunnerService(config()).exec(options);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3002/exec');
  });

  it('honours a configured runner URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    });
    await new SandboxRunnerService(config('http://sandbox:9999')).exec(options);
    expect(fetchMock.mock.calls[0][0]).toBe('http://sandbox:9999/exec');
  });

  it('forwards the sandbox limits rather than inventing its own', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ exitCode: 0, stdout: 'hi', stderr: '' }),
    });
    await new SandboxRunnerService(config()).exec(options);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      command: 'echo hi',
      workspaceDir: '/workspace',
      memoryMb: 256,
      networkEnabled: false,
      envVars: { FOO: 'bar' },
    });
  });

  it('passes the runner result through unchanged', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ exitCode: 42, stdout: 'out', stderr: 'err' }),
    });
    const res = await new SandboxRunnerService(config()).exec(options);
    expect(res).toEqual({ exitCode: 42, stdout: 'out', stderr: 'err' });
  });

  // A missing or broken sidecar must surface as a failed command, not as a
  // thrown exception that unwinds the agent's whole tool call.
  it('reports an HTTP error as a failed command', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    });
    const res = await new SandboxRunnerService(config()).exec(options);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('500');
  });

  it('reports an unreachable sidecar as a failed command', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await new SandboxRunnerService(config()).exec(options);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('unreachable');
  });
});
