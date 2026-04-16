import { z } from 'zod';
import { exec } from 'child_process';
import { validateCommand } from '../security/command-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const MAX_OUTPUT_SIZE = 64 * 1024;

const parameters = z.object({
  script: z
    .string()
    .describe('Bash script to execute (multi-line supported)'),
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

export class BashTool implements Tool<typeof parameters> {
  readonly name = 'bash';
  readonly description =
    'Execute a multi-line bash script in the workspace. Useful for running complex sequences of commands.';
  readonly parameters = parameters;

  constructor(
    private readonly workspaceDir: string,
    private readonly enabled: boolean = false,
  ) {}

  private resolveWorkspace(context: ToolExecutionContext): string {
    return context.workspaceDir ?? this.workspaceDir;
  }

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.enabled) {
      return {
        success: false,
        error:
          'Shell execution is disabled. Set ENABLE_SHELL_TOOL=true to enable.',
      };
    }

    const { script, cwd, timeoutMs } = args;

    const validation = validateCommand(script);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const workspace = this.resolveWorkspace(context);
    const workingDir = cwd ? `${workspace}/${cwd}` : workspace;

    return new Promise((resolve) => {
      const child = exec(
        script,
        {
          cwd: workingDir,
          shell: '/bin/bash',
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_SIZE,
          env: { ...process.env, PATH: process.env.PATH },
        },
        (error, stdout, stderr) => {
          if (error && error.killed) {
            resolve({
              success: false,
              error: `Script timed out after ${timeoutMs}ms`,
            });
            return;
          }

          const truncate = (s: string) =>
            s.length > MAX_OUTPUT_SIZE
              ? s.slice(0, MAX_OUTPUT_SIZE) + '\n[...truncated]'
              : s;

          resolve({
            success: !error,
            result: {
              exitCode: error ? (error.code ?? 1) : 0,
              stdout: truncate(stdout),
              stderr: truncate(stderr),
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
