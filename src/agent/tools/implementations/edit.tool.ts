import { z } from 'zod';
import * as fs from 'fs/promises';
import { validatePath, pathExists } from '../security/path-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const parameters = z.object({
  path: z.string().describe('File path relative to workspace'),
  old_text: z.string().describe('Text to find in the file'),
  new_text: z.string().describe('Replacement text'),
  all: z
    .boolean()
    .optional()
    .default(false)
    .describe('Replace all occurrences'),
});

export class EditTool implements Tool<typeof parameters> {
  readonly name = 'edit';
  readonly description =
    'Edit file contents by replacing text. Finds the first occurrence of old_text and replaces it with new_text.';
  readonly parameters = parameters;

  constructor(private readonly workspaceDir: string) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { path: filePath, old_text, new_text, all } = args;

    const validation = validatePath(filePath, this.workspaceDir);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const resolved = validation.resolvedPath!;

    if (!(await pathExists(resolved))) {
      return { success: false, error: 'File not found' };
    }

    try {
      const content = await fs.readFile(resolved, 'utf-8');
      let updated: string;
      let replacements: number;

      if (all) {
        const parts = content.split(old_text);
        replacements = parts.length - 1;
        if (replacements === 0) {
          return { success: false, error: 'Text not found in file' };
        }
        updated = parts.join(new_text);
      } else {
        const index = content.indexOf(old_text);
        if (index === -1) {
          return { success: false, error: 'Text not found in file' };
        }
        updated =
          content.slice(0, index) +
          new_text +
          content.slice(index + old_text.length);
        replacements = 1;
      }

      await fs.writeFile(resolved, updated, 'utf-8');
      return {
        success: true,
        result: { path: resolved, replacements },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Edit operation failed',
      };
    }
  }
}
