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
import { resolveWorkspace, truncateOutput, disabledError } from './tool-utils';

const MAX_OUTPUT_SIZE = 64 * 1024;

export interface ToolApprovalRequester {
  requestApproval(input: {
    threadID: string;
    runID: string;
    actionName: string;
    args: Record<string, unknown>;
    message: string;
  }): Promise<{ confirmationID: string; fingerprint: string }>;
}

const parameters = z.object({
  command: z.string().describe('Shell command to execute'),
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

export class ExecTool implements Tool<typeof parameters> {
  readonly name = 'exec';
  readonly description =
    'Execute a shell command in the workspace. Dangerous commands are blocked for safety.';
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

    const { command, cwd, timeoutMs } = args;

    const validation = validateCommand(command);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    if (validation.action === 'approval_required') {
      if (!this.approvalRequester) {
        return {
          success: false,
          error:
            'Command requires approval, but approval handling is unavailable',
        };
      }
      const approval = await this.approvalRequester.requestApproval({
        threadID: context.threadID,
        runID: context.runID,
        actionName: this.name,
        args: { command, cwd, timeoutMs },
        message: `Approval required to execute command: ${command}`,
      });
      return {
        success: false,
        result: { status: 'approval_required', ...approval },
        error: `Command requires approval (${approval.confirmationID})`,
      };
    }

    const workspace = resolveWorkspace(context, this.workspaceDir);
    const cwdValidation = validatePath(cwd ?? '.', workspace);
    if (!cwdValidation.valid) {
      return { success: false, error: cwdValidation.error };
    }

    if (context.sandbox && this.sandboxRunner) {
      const result = await this.sandboxRunner.exec({
        command,
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
        resolve({ success: false, error: 'Command cancelled' });
        return;
      }
      let timeout: NodeJS.Timeout | undefined;
      const child = exec(
        command,
        {
          cwd: workingDir,
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_SIZE,
          env: { ...process.env, PATH: process.env.PATH },
        },
        (error, stdout, stderr) => {
          if (timeout) clearTimeout(timeout);
          context.abortSignal?.removeEventListener('abort', abort);
          if (context.abortSignal?.aborted) {
            resolve({ success: false, error: 'Command cancelled' });
            return;
          }
          if (error && error.killed) {
            resolve({
              success: false,
              error: `Command timed out after ${timeoutMs}ms`,
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
}
