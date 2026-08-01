import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SandboxContext } from '../tools/tool.interface';
import {
  DEFAULT_RUNNER_PORT,
  DEFAULT_TIMEOUT_MS,
  type SandboxExecRequest,
  type SandboxExecResponse,
} from '../../sandbox-runner/protocol';

export interface SandboxExecOptions {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  workspaceDir: string;
  agentID: string;
  sandbox: SandboxContext;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Dispatches agent-authored commands to the sandbox sidecar rather than running
 * them in this process.
 *
 * This container's environment holds the model keys, the GitHub PAT, and the
 * database URIs. `/proc/1/environ` is readable by any process running as the
 * same uid, so a command executed here can recover all of them no matter how
 * carefully its own environment is scrubbed. The sidecar runs with none of
 * those variables set, and pod containers have separate PID namespaces, so a
 * command there has nothing to read.
 *
 * Consequence worth keeping in mind: the sidecar sees only the shared workspace
 * and media volumes. A command touching a path that exists solely in this
 * container's filesystem will not find it.
 */
@Injectable()
export class SandboxRunnerService implements OnModuleInit {
  private readonly logger = new Logger(SandboxRunnerService.name);
  private readonly runnerUrl: string;

  constructor(configService: ConfigService) {
    this.runnerUrl =
      configService.get<string>('SANDBOX_RUNNER_URL') ??
      `http://127.0.0.1:${DEFAULT_RUNNER_PORT}`;
  }

  async onModuleInit(): Promise<void> {
    // Probe rather than assume. A missing sidecar means every shell, exec, and
    // code_execution call fails at request time, which is worth surfacing at
    // boot instead of on the agent's first tool call.
    try {
      const res = await fetch(`${this.runnerUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.logger.log(`Sandbox sidecar reachable at ${this.runnerUrl}`);
    } catch (err) {
      this.logger.warn(
        `Sandbox sidecar unreachable at ${this.runnerUrl} (${
          err instanceof Error ? err.message : String(err)
        }) — shell, exec, and code_execution will fail until it is up`,
      );
    }
  }

  async exec(options: SandboxExecOptions): Promise<SandboxExecResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const body: SandboxExecRequest = {
      command: options.command,
      cwd: options.cwd,
      timeoutMs,
      workspaceDir: options.workspaceDir,
      memoryMb: options.sandbox.memoryMb,
      networkEnabled: options.sandbox.networkEnabled,
      envVars: options.sandbox.envVars,
    };

    try {
      const res = await fetch(`${this.runnerUrl}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // The runner enforces the real timeout and returns 137 on expiry. This
        // is the outer bound for the round trip itself.
        signal: AbortSignal.timeout(timeoutMs + 10_000),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Sandbox runner error (HTTP ${res.status}): ${detail}`,
        };
      }

      const result = (await res.json()) as SandboxExecResponse;
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Sandbox exec dispatch failed: ${message}`);
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Sandbox runner unreachable: ${message}`,
      };
    }
  }
}
