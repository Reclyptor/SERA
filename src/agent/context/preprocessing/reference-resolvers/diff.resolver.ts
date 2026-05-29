import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const MAX_DIFF_CHARS = 64 * 1024;
const TRUNCATE_MARKER = '\n…[truncated]';

export interface DiffResolveInput {
  workspaceDir: string;
  staged?: boolean;
  ref?: string; // for @git:<ref>
}

export interface DiffResolveResult {
  text: string;
}

@Injectable()
export class DiffReferenceResolver {
  readonly kind = 'diff';
  private readonly logger = new Logger(DiffReferenceResolver.name);

  async resolve(input: DiffResolveInput): Promise<DiffResolveResult> {
    const args = this.buildArgs(input);
    try {
      const { stdout } = await execAsync(`git ${args}`, {
        cwd: input.workspaceDir,
        timeout: 10_000,
        maxBuffer: MAX_DIFF_CHARS * 2,
        env: { ...process.env, GIT_PAGER: 'cat' },
      });
      const truncated =
        stdout.length > MAX_DIFF_CHARS
          ? stdout.slice(0, MAX_DIFF_CHARS) + TRUNCATE_MARKER
          : stdout;
      if (!truncated.trim()) {
        return {
          text: `\`\`\`diff (${this.label(input)})\n[no changes]\n\`\`\``,
        };
      }
      return {
        text: `\`\`\`diff (${this.label(input)})\n${truncated}\n\`\`\``,
      };
    } catch (err) {
      this.logger.warn(`Git diff resolve failed: ${String(err)}`);
      return { text: `[diff ${this.label(input)}: ${(err as Error).message}]` };
    }
  }

  private buildArgs(input: DiffResolveInput): string {
    if (input.ref) return `show --no-color ${shellEscape(input.ref)}`;
    if (input.staged) return 'diff --staged --no-color';
    return 'diff --no-color';
  }

  private label(input: DiffResolveInput): string {
    if (input.ref) return `git show ${input.ref}`;
    if (input.staged) return 'git diff --staged';
    return 'git diff';
  }
}

function shellEscape(value: string): string {
  // Allow a conservative set of git-safe characters; anything else is rejected.
  if (!/^[A-Za-z0-9._\-/@^~]+$/.test(value)) {
    throw new Error(`unsafe git ref: ${value}`);
  }
  return value;
}
