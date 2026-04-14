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
  ) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.enabled) {
      return {
        success: false,
        error:
          'Shell execution is disabled. Set ENABLE_SHELL_TOOL=true to enable.',
      };
    }

    const { command, cwd, timeoutMs } = args;

    const validation = validateCommand(command);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const workingDir = cwd ? `${this.workspaceDir}/${cwd}` : this.workspaceDir;

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
