import { z } from 'zod';
import * as fs from 'fs/promises';
import { validatePath, pathExists } from '../security/path-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const MAX_FILE_SIZE = 512 * 1024; // 512KB

const parameters = z.object({
  path: z.string().describe('File or directory path relative to workspace'),
  encoding: z
    .enum(['utf-8', 'base64'])
    .optional()
    .default('utf-8')
    .describe('File encoding'),
});

export class ReadTool implements Tool<typeof parameters> {
  readonly name = 'read';
  readonly parallelSafe = true;
  readonly description =
    'Read file contents or list directory entries within the workspace.';
  readonly parameters = parameters;

  constructor(private readonly workspaceDir: string) {}

  private resolveWorkspace(context: ToolExecutionContext): string {
    return context.workspaceDir ?? this.workspaceDir;
  }

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { path: filePath, encoding } = args;

    const validation = validatePath(filePath, this.resolveWorkspace(context));
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const resolved = validation.resolvedPath!;

    if (!(await pathExists(resolved))) {
      return { success: false, error: 'Path not found' };
    }

    try {
      const stats = await fs.stat(resolved);

      if (stats.isDirectory()) {
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const items = entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        }));
        return { success: true, result: { path: resolved, items } };
      }

      if (stats.size > MAX_FILE_SIZE) {
        return {
          success: false,
          error: `File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`,
        };
      }

      const content = await fs.readFile(resolved, encoding as BufferEncoding);
      return {
        success: true,
        result: {
          content,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Read operation failed',
      };
    }
  }
}
