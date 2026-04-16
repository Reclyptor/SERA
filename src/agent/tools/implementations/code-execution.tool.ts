import { z } from 'zod';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const MAX_OUTPUT_SIZE = 64 * 1024;

const LANGUAGE_CONFIG: Record<string, { ext: string; runner: string }> = {
  javascript: { ext: '.js', runner: 'node' },
  typescript: { ext: '.ts', runner: 'npx tsx' },
  python: { ext: '.py', runner: 'python3' },
};

const parameters = z.object({
  language: z
    .enum(['javascript', 'typescript', 'python'])
    .describe('Programming language'),
  code: z.string().describe('Code to execute'),
  timeoutMs: z
    .number()
    .optional()
    .default(15000)
    .describe('Timeout in milliseconds'),
});

export class CodeExecutionTool implements Tool<typeof parameters> {
  readonly name = 'code_execution';
  readonly description =
    'Execute code in a sandboxed environment. Supports JavaScript/TypeScript and Python.';
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
          'Code execution is disabled. Set ENABLE_SHELL_TOOL=true to enable.',
      };
    }

    const { language, code, timeoutMs } = args;
    const config = LANGUAGE_CONFIG[language];
    const workspace = this.resolveWorkspace(context);
    const tmpDir = path.join(workspace, '.tmp');
    const filename = `exec_${randomUUID()}${config.ext}`;
    const filePath = path.join(tmpDir, filename);

    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(filePath, code, 'utf-8');

    try {
      return await new Promise((resolve) => {
        const child = exec(
          `${config.runner} ${filePath}`,
          {
            cwd: workspace,
            timeout: timeoutMs,
            maxBuffer: MAX_OUTPUT_SIZE,
            env: { ...process.env, PATH: process.env.PATH },
          },
          (error, stdout, stderr) => {
            if (error && error.killed) {
              resolve({
                success: false,
                error: `Execution timed out after ${timeoutMs}ms`,
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
                language,
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
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  }
}
