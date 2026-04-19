import type { SandboxContext } from '../tool.interface';

export interface SandboxRunnerLike {
  exec(options: {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    workspaceDir: string;
    agentID: string;
    sandbox: SandboxContext;
  }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}
