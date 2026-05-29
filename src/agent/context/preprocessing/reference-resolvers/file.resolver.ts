import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import {
  validatePath,
  pathExists,
} from '../../../tools/security/path-validator';

const MAX_FILE_CHARS = 64 * 1024; // 64 KB cap per file reference.
const TRUNCATE_MARKER = '\n…[truncated]';

export interface FileResolveInput {
  target: string; // path[:start-end]
  workspaceDir: string;
}

export interface FileResolveResult {
  text: string;
}

@Injectable()
export class FileReferenceResolver {
  readonly kind = 'file';
  private readonly logger = new Logger(FileReferenceResolver.name);

  async resolve(input: FileResolveInput): Promise<FileResolveResult> {
    const { path, lineStart, lineEnd } = this.parseTarget(input.target);
    const validation = validatePath(path, input.workspaceDir);
    if (!validation.valid) {
      return { text: `[file ${path}: ${validation.error}]` };
    }
    const resolved = validation.resolvedPath!;
    if (!(await pathExists(resolved))) {
      return { text: `[file ${path}: not found]` };
    }
    try {
      const stats = await fs.stat(resolved);
      if (stats.isDirectory()) {
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const lines = entries
          .slice(0, 50)
          .map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
          .join('\n');
        return {
          text: this.format(`folder ${path}`, lines, entries.length > 50),
        };
      }
      const raw = await fs.readFile(resolved, 'utf-8');
      const sliced = this.slice(raw, lineStart, lineEnd);
      const truncated =
        sliced.length > MAX_FILE_CHARS
          ? sliced.slice(0, MAX_FILE_CHARS) + TRUNCATE_MARKER
          : sliced;
      return {
        text: this.format(
          this.label(path, lineStart, lineEnd),
          truncated,
          false,
        ),
      };
    } catch (err) {
      this.logger.warn(`Failed to read @file:${input.target}: ${String(err)}`);
      return {
        text: `[file ${path}: read failed: ${(err as Error).message}]`,
      };
    }
  }

  private parseTarget(target: string): {
    path: string;
    lineStart?: number;
    lineEnd?: number;
  } {
    // path[:start[-end]]
    const m = /^(.*?)(?::(\d+)(?:-(\d+))?)?$/.exec(target);
    if (!m) return { path: target };
    const [, path, start, end] = m;
    const lineStart = start ? parseInt(start, 10) : undefined;
    const lineEnd = end ? parseInt(end, 10) : undefined;
    return { path, lineStart, lineEnd };
  }

  private slice(text: string, start?: number, end?: number): string {
    if (start === undefined) return text;
    const lines = text.split('\n');
    const from = Math.max(0, start - 1);
    const to = end !== undefined ? Math.min(lines.length, end) : lines.length;
    return lines.slice(from, to).join('\n');
  }

  private label(path: string, start?: number, end?: number): string {
    if (start === undefined) return `file ${path}`;
    if (end === undefined) return `file ${path}:${start}`;
    return `file ${path}:${start}-${end}`;
  }

  private format(label: string, body: string, truncated: boolean): string {
    return `\`\`\`${truncated ? ' (truncated)' : ''} ${label}\n${body}\n\`\`\``;
  }
}
