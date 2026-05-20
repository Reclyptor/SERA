import { z } from 'zod';
import * as fs from 'fs/promises';
import { validatePath, pathExists } from '../security/path-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolResource,
} from '../tool.interface';
import { resolveWorkspace } from './tool-utils';

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

const parameters = z.object({
  path: z.string().describe('File path relative to workspace'),
  patch: z
    .string()
    .describe(
      'Unified diff patch content (lines starting with +/- and context lines)',
    ),
});

export class ApplyPatchTool implements Tool<typeof parameters> {
  readonly name = 'apply_patch';
  readonly description =
    'Apply a unified diff patch to a file. Supports multi-hunk patches.';
  readonly parameters = parameters;

  constructor(private readonly workspaceDir: string) {}

  getResources(args: z.infer<typeof parameters>): ToolResource[] {
    return [{ type: 'workspace-path', path: args.path, mode: 'write' }];
  }

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { path: filePath, patch } = args;

    const validation = validatePath(
      filePath,
      resolveWorkspace(context, this.workspaceDir),
    );
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const resolved = validation.resolvedPath!;

    if (!(await pathExists(resolved))) {
      return { success: false, error: 'File not found' };
    }

    try {
      const content = await fs.readFile(resolved, 'utf-8');
      const hunks = this.parseHunks(patch);

      if (hunks.length === 0) {
        return { success: false, error: 'No valid hunks found in patch' };
      }

      const lines = content.split('\n');

      // Apply hunks in reverse order to preserve line offsets
      const sorted = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

      for (const hunk of sorted) {
        const result = this.applyHunk(lines, hunk);
        if (!result.success) {
          return { success: false, error: result.error };
        }
      }

      await fs.writeFile(resolved, lines.join('\n'), 'utf-8');
      return {
        success: true,
        result: { path: resolved, hunksApplied: hunks.length },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Patch operation failed',
      };
    }
  }

  private parseHunks(patch: string): Hunk[] {
    const patchLines = patch.split('\n');
    const hunks: Hunk[] = [];
    let current: Hunk | null = null;

    for (const line of patchLines) {
      const headerMatch = line.match(
        /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/,
      );

      if (headerMatch) {
        if (current) {
          hunks.push(current);
        }
        current = {
          oldStart: parseInt(headerMatch[1], 10),
          oldCount: parseInt(headerMatch[2] ?? '1', 10),
          newStart: parseInt(headerMatch[3], 10),
          newCount: parseInt(headerMatch[4] ?? '1', 10),
          lines: [],
        };
        continue;
      }

      if (current) {
        if (
          line.startsWith('+') ||
          line.startsWith('-') ||
          line.startsWith(' ') ||
          line === ''
        ) {
          // Treat lines without a prefix as context lines
          current.lines.push(line === '' ? ' ' : line);
        }
      }
    }

    if (current) {
      hunks.push(current);
    }

    return hunks;
  }

  private applyHunk(
    lines: string[],
    hunk: Hunk,
  ): { success: boolean; error?: string } {
    // Unified diff line numbers are 1-based
    const startIndex = hunk.oldStart - 1;

    // Verify context and remove lines match the file
    let fileIndex = startIndex;
    for (const hunkLine of hunk.lines) {
      const prefix = hunkLine[0];
      const text = hunkLine.slice(1);

      if (prefix === ' ' || prefix === '-') {
        if (fileIndex >= lines.length) {
          return {
            success: false,
            error: `Context mismatch at line ${fileIndex + 1}: unexpected end of file`,
          };
        }
        if (lines[fileIndex] !== text) {
          return {
            success: false,
            error: `Context mismatch at line ${fileIndex + 1}: expected "${text}", found "${lines[fileIndex]}"`,
          };
        }
        fileIndex++;
      }
      // '+' lines don't consume file lines during verification
    }

    // Build replacement lines
    const removeCount = hunk.lines.filter(
      (l) => l[0] === '-' || l[0] === ' ',
    ).length;

    const newLines: string[] = [];
    for (const hunkLine of hunk.lines) {
      const prefix = hunkLine[0];
      const text = hunkLine.slice(1);

      if (prefix === ' ' || prefix === '+') {
        newLines.push(text);
      }
    }

    lines.splice(startIndex, removeCount, ...newLines);
    return { success: true };
  }
}
