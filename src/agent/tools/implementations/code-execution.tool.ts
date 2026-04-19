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
import type { SandboxRunnerLike } from './sandbox.types';
import type { ToolsRegistry } from '../tools.registry';
import { startToolBridge, writeHelperLibraries } from './tool-bridge';

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
    'Execute code in a sandboxed environment. Supports JavaScript/TypeScript and Python. ' +
    'Scripts can call back into SERA tools via the sera_tools helper library ' +
    '(require("./sera_tools") for JS/TS, import sera_tools for Python). ' +
    'Available bridge tools: read, web_fetch, web_search, memory_search, memory_get.';
  readonly parameters = parameters;

  constructor(
    private readonly workspaceDir: string,
    private readonly enabled: boolean = false,
    private readonly sandboxRunner?: SandboxRunnerLike,
    private readonly toolsRegistry?: ToolsRegistry,
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

    // Start the tool bridge so scripts can call back into SERA tools
    const bridge = this.toolsRegistry
      ? await startToolBridge(this.toolsRegistry, context)
      : null;

    try {
      if (bridge) {
        await writeHelperLibraries(tmpDir, bridge.url, bridge.secret);
      }

      await fs.writeFile(filePath, code, 'utf-8');

      if (context.sandbox && this.sandboxRunner) {
        const containerPath = `.tmp/${filename}`;
        const envVars = bridge
          ? { ...context.sandbox.envVars, SERA_BRIDGE_URL: bridge.url, SERA_BRIDGE_SECRET: bridge.secret }
          : context.sandbox.envVars;
        const result = await this.sandboxRunner.exec({
          command: `${config.runner} ${containerPath}`,
          timeoutMs,
          workspaceDir: workspace,
          agentID: context.agentID,
          sandbox: { ...context.sandbox, envVars },
        });
        return {
          success: result.exitCode === 0,
          result: { language, ...result },
          error: result.exitCode !== 0 ? result.stderr : undefined,
        };
      }

      const bridgeEnv = bridge ? { SERA_BRIDGE_URL: bridge.url, SERA_BRIDGE_SECRET: bridge.secret } : {};

      return await new Promise((resolve) => {
        const child = exec(
          `${config.runner} ${filePath}`,
          {
            cwd: workspace,
            timeout: timeoutMs,
            maxBuffer: MAX_OUTPUT_SIZE,
            env: { ...process.env, ...bridgeEnv, PATH: process.env.PATH },
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
      await bridge?.close();
      await fs.unlink(filePath).catch(() => {});
      if (bridge) {
        await Promise.all([
          fs.unlink(path.join(tmpDir, 'sera_tools.js')).catch(() => {}),
          fs.unlink(path.join(tmpDir, 'sera_tools.py')).catch(() => {}),
        ]);
      }
    }
  }
}
