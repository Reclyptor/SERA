import { z } from 'zod';
import { exec } from 'child_process';
import { validateCommand } from '../security/command-validator';
import { validatePath } from '../security/path-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolResource,
} from '../tool.interface';
import type { SandboxRunnerLike } from './sandbox.types';
import { buildToolEnv, truncateOutput, disabledError } from './tool-utils';
import type { ToolApprovalRequester } from './exec.tool';

const MAX_OUTPUT_SIZE = 64 * 1024;

const parameters = z.object({
  script: z.string().describe('Shell script to execute (multi-line supported)'),
  cwd: z
    .string()
    .optional()
    .describe('Working directory relative to workspace'),
  timeoutMs: z
    .number()
    .optional()
    .default(30000)
    .describe('Timeout in milliseconds'),
});

export class ShellTool implements Tool<typeof parameters> {
  readonly name = 'shell';
  readonly description =
    'Execute a multi-line shell script in the workspace. Useful for running complex sequences of commands.';
  readonly parameters = parameters;

  constructor(
    private readonly workspaceDir: string,
    private readonly enabled: boolean = false,
    private readonly sandboxRunner?: SandboxRunnerLike,
    private readonly approvalRequester?: ToolApprovalRequester,
  ) {}

  getResources(): ToolResource[] {
    return [{ type: 'process' }];
  }

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.enabled) {
      return disabledError('Shell execution', 'ENABLE_SHELL_TOOL');
    }

    const { script, cwd, timeoutMs } = args;

    const validation = validateCommand(script);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    if (validation.action === 'approval_required') {
      if (!this.approvalRequester) {
        return {
          success: false,
          error:
            'Script requires approval, but approval handling is unavailable',
        };
      }
      const approval = await this.approvalRequester.requestApproval({
        threadID: context.threadID,
        runID: context.runID,
        actionName: this.name,
        args: { script, cwd, timeoutMs },
        message: `Approval required to execute shell script:\n${script}`,
      });
      if (approval.status === 'rejected') {
        return {
          success: false,
          error: `Script rejected by operator${
            approval.feedback ? `: ${approval.feedback}` : ''
          }`,
        };
      }
      if (approval.status === 'pending') {
        return {
          success: false,
          result: {
            status: 'approval_required',
            confirmationID: approval.confirmationID,
            fingerprint: approval.fingerprint,
          },
          error: `Script requires approval (${approval.confirmationID})`,
        };
      }
      // approval.status === 'approved' → fall through and execute.
    }

    const workspace = this.workspaceDir;
    const cwdValidation = validatePath(cwd ?? '.', workspace);
    if (!cwdValidation.valid) {
      return { success: false, error: cwdValidation.error };
    }

    if (context.sandbox && this.sandboxRunner) {
      const result = await this.sandboxRunner.exec({
        command: script,
        cwd,
        timeoutMs,
        workspaceDir: workspace,
        agentID: context.agentID,
        sandbox: context.sandbox,
      });
      return {
        success: result.exitCode === 0,
        result,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    }

    const workingDir = cwdValidation.resolvedPath!;

    return new Promise((resolve) => {
      if (context.abortSignal?.aborted) {
        resolve({ success: false, error: 'Script cancelled' });
        return;
      }
      let timeout: NodeJS.Timeout | undefined = undefined;
      const child = exec(
        script,
        {
          cwd: workingDir,
          shell: '/bin/sh',
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_SIZE,
          env: buildToolEnv(),
        },
        (error, stdout, stderr) => {
          if (timeout) clearTimeout(timeout);
          context.abortSignal?.removeEventListener('abort', abort);
          if (context.abortSignal?.aborted) {
            resolve({ success: false, error: 'Script cancelled' });
            return;
          }
          if (error && error.killed) {
            resolve({
              success: false,
              error: `Script timed out after ${timeoutMs}ms`,
            });
            return;
          }

          resolve({
            success: !error,
            result: {
              exitCode: error ? (error.code ?? 1) : 0,
              stdout: truncateOutput(stdout, MAX_OUTPUT_SIZE),
              stderr: truncateOutput(stderr, MAX_OUTPUT_SIZE),
            },
            error: error ? error.message : undefined,
          });
        },
      );

      const abort = () => child.kill('SIGTERM');
      context.abortSignal?.addEventListener('abort', abort, { once: true });
      timeout = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeoutMs + 1000);
    });
  }

  renderResultSummary(
    args: z.infer<typeof parameters>,
    result: unknown,
  ): string {
    const firstLine = args.script.split('\n')[0] ?? '';
    const snippet =
      firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;
    if (result == null || typeof result !== 'object') {
      return `[shell] ${snippet}`;
    }
    const r = result as { exitCode?: number; stdout?: string };
    const stdout = typeof r.stdout === 'string' ? r.stdout : '';
    const lines = stdout ? stdout.split('\n').length : 0;
    const exitCode = typeof r.exitCode === 'number' ? r.exitCode : '?';
    return `[shell] ${snippet} -> exit ${exitCode}, ${lines} lines`;
  }
}
