import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const parameters = z.object({
  prompt: z.string().describe('Text description of the image to generate'),
  size: z
    .enum(['1024x1024', '1024x1792', '1792x1024'])
    .optional()
    .default('1024x1024')
    .describe('Image size'),
  quality: z
    .enum(['standard', 'hd'])
    .optional()
    .default('standard')
    .describe('Image quality'),
});

export class ImageGenerateTool implements Tool<typeof parameters> {
  readonly name = 'image_generate';
  readonly description =
    'Generate images using AI. Creates images from text descriptions. Requires OPENAI_API_KEY.';
  readonly parameters = parameters;
  readonly parallelSafe = true;

  constructor(private readonly apiKey?: string) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'Image generation not configured. Set OPENAI_API_KEY to enable.',
      };
    }

    const { prompt, size, quality } = args;

    try {
      const response = await fetch(
        'https://api.openai.com/v1/images/generations',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt,
            size,
            quality,
            n: 1,
            response_format: 'url',
          }),
          signal: AbortSignal.timeout(120_000),
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          success: false,
          error: `OpenAI API returned ${response.status}: ${body.slice(0, 200)}`,
        };
      }

      const data = (await response.json()) as {
        data?: Array<{ url?: string; revised_prompt?: string }>;
      };
      const first = data.data?.[0];
      if (!first?.url) {
        return {
          success: false,
          error: 'OpenAI returned no image URL',
        };
      }
      return {
        success: true,
        result: {
          prompt,
          url: first.url,
          revisedPrompt: first.revised_prompt,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Image generation failed',
      };
    }
  }

  renderResultSummary(
    args: z.infer<typeof parameters>,
    result: unknown,
  ): string {
    const prompt =
      args.prompt.length > 60 ? args.prompt.slice(0, 57) + '...' : args.prompt;
    if (result == null || typeof result !== 'object') {
      return `[image_generate] prompt='${prompt}' (${args.size})`;
    }
    const r = result as { url?: string };
    return `[image_generate] prompt='${prompt}' (${args.size}) -> ${r.url ? 'url' : 'no url'}`;
  }
}
