import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { validatePath, pathExists } from '../security/path-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const MAX_FILE_SIZE = 512 * 1024; // 512KB

const parameters = z.object({
  operation: z
    .enum(['read', 'write', 'append', 'list', 'exists', 'delete', 'mkdir'])
    .describe('File operation to perform'),
  path: z.string().describe('File or directory path (relative to workspace)'),
  content: z
    .string()
    .optional()
    .describe('Content for write/append operations'),
  encoding: z
    .enum(['utf-8', 'base64'])
    .optional()
    .default('utf-8')
    .describe('File encoding'),
});

export class FileIOTool implements Tool<typeof parameters> {
  readonly name = 'file_io';
  readonly description =
    'Read, write, list, and manage files within the workspace directory. All paths are sandboxed to the workspace.';
  readonly parameters = parameters;

  constructor(private readonly workspaceDir: string) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { operation, path: filePath, content, encoding } = args;

    const validation = validatePath(filePath, this.workspaceDir);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const resolved = validation.resolvedPath!;

    try {
      switch (operation) {
        case 'read':
          return await this.readFile(resolved, encoding);
        case 'write':
          return await this.writeFile(resolved, content, encoding);
        case 'append':
          return await this.appendFile(resolved, content, encoding);
        case 'list':
          return await this.listDirectory(resolved);
        case 'exists':
          return {
            success: true,
            result: { exists: await pathExists(resolved) },
          };
        case 'delete':
          return await this.deleteFile(resolved);
        case 'mkdir':
          return await this.makeDirectory(resolved);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'File operation failed',
      };
    }
  }

  private async readFile(
    filePath: string,
    encoding: string,
  ): Promise<ToolExecutionResult> {
    if (!(await pathExists(filePath))) {
      return { success: false, error: 'File not found' };
    }

    const stats = await fs.stat(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`,
      };
    }

    const content = await fs.readFile(filePath, encoding as BufferEncoding);
    return {
      success: true,
      result: {
        content,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      },
    };
  }

  private async writeFile(
    filePath: string,
    content: string | undefined,
    encoding: string,
  ): Promise<ToolExecutionResult> {
    if (content === undefined) {
      return {
        success: false,
        error: 'Content is required for write operations',
      };
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, encoding as BufferEncoding);
    return { success: true, result: { written: filePath } };
  }

  private async appendFile(
    filePath: string,
    content: string | undefined,
    encoding: string,
  ): Promise<ToolExecutionResult> {
    if (content === undefined) {
      return {
        success: false,
        error: 'Content is required for append operations',
      };
    }

    await fs.appendFile(filePath, content, encoding as BufferEncoding);
    return { success: true, result: { appended: filePath } };
  }

  private async listDirectory(dirPath: string): Promise<ToolExecutionResult> {
    if (!(await pathExists(dirPath))) {
      return { success: false, error: 'Directory not found' };
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const items = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    }));

    return { success: true, result: { path: dirPath, items } };
  }

  private async deleteFile(filePath: string): Promise<ToolExecutionResult> {
    if (!(await pathExists(filePath))) {
      return { success: false, error: 'File not found' };
    }

    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      return {
        success: false,
        error: 'Cannot delete directories. Use shell for that.',
      };
    }

    await fs.unlink(filePath);
    return { success: true, result: { deleted: filePath } };
  }

  private async makeDirectory(dirPath: string): Promise<ToolExecutionResult> {
    await fs.mkdir(dirPath, { recursive: true });
    return { success: true, result: { created: dirPath } };
  }
}
