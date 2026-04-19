import { z } from 'zod';
import { exec } from 'child_process';
import { validateCommand } from '../security/command-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';
import type { SandboxRunnerLike } from './sandbox.types';
import { resolveWorkspace, truncateOutput, disabledError } from './tool-utils';

const MAX_OUTPUT_SIZE = 64 * 1024;

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
  ) {}

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

    const workspace = resolveWorkspace(context, this.workspaceDir);

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

    const workingDir = cwd ? `${workspace}/${cwd}` : workspace;

    return new Promise((resolve) => {
      const child = exec(
        command,
        {
          cwd: workingDir,
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_SIZE,
          env: { ...process.env, PATH: process.env.PATH },
        },
        (error, stdout, stderr) => {
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

      setTimeout(() => {
        child.kill('SIGTERM');
      }, timeoutMs + 1000);
    });
  }
}
