import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { validatePath } from '../security/path-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const parameters = z.object({
  source: z.string().describe('Image URL or workspace file path'),
  question: z
    .string()
    .optional()
    .default('Describe this image in detail.')
    .describe('Question about the image'),
});

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export class ImageTool implements Tool<typeof parameters> {
  readonly name = 'image';
  readonly description =
    'Analyze images using AI vision. Provide a URL or workspace file path to get a description or answer questions about the image.';
  readonly parameters = parameters;

  constructor(
    private readonly apiKey?: string,
    private readonly workspaceDir?: string,
  ) {}

  private resolveWorkspace(context: ToolExecutionContext): string | undefined {
    return context.workspaceDir ?? this.workspaceDir;
  }

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error:
          'Image analysis not configured. Set OPENAI_API_KEY to enable.',
      };
    }

    const { source, question } = args;

    try {
      const imageUrl = await this.resolveImageUrl(source, context);

      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: question },
                  { type: 'image_url', image_url: { url: imageUrl } },
                ],
              },
            ],
            max_tokens: 1024,
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          success: false,
          error: `OpenAI API returned ${response.status}: ${body.slice(0, 200)}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        result: {
          source,
          analysis: data.choices[0].message.content,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Image analysis failed',
      };
    }
  }

  private async resolveImageUrl(source: string, context: ToolExecutionContext): Promise<string> {
    if (source.startsWith('http://') || source.startsWith('https://')) {
      return source;
    }

    const workspace = this.resolveWorkspace(context);
    if (!workspace) {
      throw new Error(
        'Workspace directory not configured for file-based image analysis',
      );
    }

    const validation = validatePath(source, workspace);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const resolved = validation.resolvedPath!;
    const ext = path.extname(resolved).toLowerCase();
    const mimeType = MIME_TYPES[ext];
    if (!mimeType) {
      throw new Error(
        `Unsupported image format: ${ext}. Supported: ${Object.keys(MIME_TYPES).join(', ')}`,
      );
    }

    const buffer = await fs.readFile(resolved);
    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  }
}
