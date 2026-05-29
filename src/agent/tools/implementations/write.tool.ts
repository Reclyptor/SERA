import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { validatePath, pathExists } from '../security/path-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolResource,
} from '../tool.interface';

const parameters = z.object({
  path: z.string().describe('File or directory path relative to workspace'),
  content: z
    .string()
    .optional()
    .describe('Content to write (required for write/append)'),
  operation: z
    .enum(['write', 'append', 'mkdir', 'delete'])
    .optional()
    .default('write')
    .describe('Operation type'),
  encoding: z
    .enum(['utf-8', 'base64'])
    .optional()
    .default('utf-8')
    .describe('File encoding'),
});

export class WriteTool implements Tool<typeof parameters> {
  readonly name = 'write';
  readonly description =
    'Write, append, or create files and directories within the workspace.';
  readonly parameters = parameters;

  constructor(private readonly workspaceDir: string) {}

  getResources(args: z.infer<typeof parameters>): ToolResource[] {
    return [{ type: 'workspace-path', path: args.path, mode: 'write' }];
  }

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { path: filePath, content, operation, encoding } = args;

    const validation = validatePath(filePath, this.workspaceDir);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const resolved = validation.resolvedPath!;

    try {
      switch (operation) {
        case 'write': {
          if (content === undefined) {
            return {
              success: false,
              error: 'Content is required for write operations',
            };
          }
          await fs.mkdir(path.dirname(resolved), { recursive: true });
          await fs.writeFile(resolved, content, encoding);
          return { success: true, result: { written: resolved } };
        }

        case 'append': {
          if (content === undefined) {
            return {
              success: false,
              error: 'Content is required for append operations',
            };
          }
          await fs.appendFile(resolved, content, encoding);
          return { success: true, result: { appended: resolved } };
        }

        case 'mkdir': {
          await fs.mkdir(resolved, { recursive: true });
          return { success: true, result: { created: resolved } };
        }

        case 'delete': {
          if (!(await pathExists(resolved))) {
            return { success: false, error: 'File not found' };
          }
          const stats = await fs.stat(resolved);
          if (stats.isDirectory()) {
            return {
              success: false,
              error: 'Cannot delete directories',
            };
          }
          await fs.unlink(resolved);
          return { success: true, result: { deleted: resolved } };
        }
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Write operation failed',
      };
    }
  }

  renderResultSummary(
    args: z.infer<typeof parameters>,
    _result: unknown,
  ): string {
    return `[write] ${args.operation ?? 'write'} ${args.path}`;
  }
}
