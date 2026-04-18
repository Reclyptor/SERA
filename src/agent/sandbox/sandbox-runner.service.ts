import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { exec } from 'child_process';
import type { SandboxContext } from '../tools/tool.interface';

const MAX_OUTPUT_SIZE = 64 * 1024;

export interface SandboxExecOptions {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  workspaceDir: string;
  agentId: string;
  sandbox: SandboxContext;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

@Injectable()
export class SandboxRunnerService implements OnModuleInit {
  private readonly logger = new Logger(SandboxRunnerService.name);
  private unsharePid = false;
  private unshareNet = false;

  async onModuleInit() {
    this.unsharePid = await this.probe('unshare --pid --fork true');
    this.unshareNet = await this.probe('unshare --net true');

    const caps = [
      this.unsharePid ? 'pid' : null,
      this.unshareNet ? 'net' : null,
    ].filter(Boolean);

    if (caps.length > 0) {
      this.logger.log(`Sandbox namespace support: ${caps.join(', ')}`);
    } else {
      this.logger.warn(
        'No namespace isolation available — falling back to ulimit-only sandbox',
      );
    }
  }

  async exec(options: SandboxExecOptions): Promise<SandboxExecResult> {
    const { command, cwd, timeoutMs = 30000, workspaceDir, sandbox } = options;
    const workDir = cwd ? `${workspaceDir}/${cwd}` : workspaceDir;
    const timeoutSec = Math.ceil(timeoutMs / 1000);
    const memKb = sandbox.memoryMb * 1024;

    const limits = [
      `ulimit -v ${memKb} 2>/dev/null`,
      `ulimit -t ${timeoutSec} 2>/dev/null`,
      `ulimit -u 64 2>/dev/null`,
      `ulimit -n 256 2>/dev/null`,
      `ulimit -f 65536 2>/dev/null`,
    ].join('; ');

    const inner = `${limits}; exec ${command}`;

    let wrapped: string;
    const nsFlags: string[] = [];
    if (this.unsharePid) nsFlags.push('--pid', '--fork');
    if (this.unshareNet && !sandbox.networkEnabled) nsFlags.push('--net');

    if (nsFlags.length > 0) {
      wrapped = `unshare ${nsFlags.join(' ')} /bin/sh -c ${this.shellQuote(inner)}`;
    } else {
      wrapped = inner;
    }

    const sanitizedEnv: Record<string, string> = {
      HOME: workDir,
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      TMPDIR: `${workDir}/.tmp`,
      LANG: 'C.UTF-8',
      ...sandbox.envVars,
    };

    return new Promise((resolve) => {
      const child = exec(
        wrapped,
        {
          cwd: workDir,
          shell: '/bin/sh',
          timeout: timeoutMs + 2000,
          maxBuffer: MAX_OUTPUT_SIZE,
          env: sanitizedEnv,
        },
        (error, stdout, stderr) => {
          if (error && error.killed) {
            resolve({
              exitCode: 137,
              stdout: '',
              stderr: `Timed out after ${timeoutMs}ms`,
            });
            return;
          }

          const truncate = (s: string) =>
            s.length > MAX_OUTPUT_SIZE
              ? s.slice(0, MAX_OUTPUT_SIZE) + '\n[...truncated]'
              : s;

          resolve({
            exitCode: error ? (error.code ?? 1) : 0,
            stdout: truncate(stdout),
            stderr: truncate(stderr),
          });
        },
      );

      setTimeout(() => child.kill('SIGTERM'), timeoutMs + 3000);
    });
  }

  private shellQuote(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  private probe(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      exec(command, { timeout: 3000 }, (error) => resolve(!error));
    });
  }
}
