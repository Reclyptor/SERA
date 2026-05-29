import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

// 5 MiB inline cap — base64-encoded audio above this overwhelms the SSE
// stream and most LLM context windows. Callers wanting larger output
// should route through object storage instead of inline base64.
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

const parameters = z.object({
  text: z.string().max(4096).describe('Text to convert to speech'),
  voice: z
    .enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'])
    .optional()
    .default('alloy')
    .describe('Voice to use'),
  model: z
    .enum(['tts-1', 'tts-1-hd'])
    .optional()
    .default('tts-1')
    .describe('TTS model'),
  format: z
    .enum(['mp3', 'opus', 'aac', 'flac'])
    .optional()
    .default('mp3')
    .describe('Output format'),
});

export class TtsTool implements Tool<typeof parameters> {
  readonly name = 'tts';
  readonly description =
    'Convert text to speech using AI. Returns audio as a base64-encoded string. Requires OPENAI_API_KEY.';
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
        error: 'TTS not configured. Set OPENAI_API_KEY to enable.',
      };
    }

    const { text, voice, model, format } = args;

    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: text,
          voice,
          response_format: format,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          success: false,
          error: `OpenAI API returned ${response.status}: ${body.slice(0, 200)}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) {
        return {
          success: false,
          error: `TTS audio (${arrayBuffer.byteLength} bytes) exceeds the ${MAX_AUDIO_BYTES}-byte inline cap. Shorten the input or split into multiple calls.`,
        };
      }
      const audio = Buffer.from(arrayBuffer).toString('base64');

      return {
        success: true,
        result: {
          format,
          voice,
          size: arrayBuffer.byteLength,
          audio,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Text-to-speech failed',
      };
    }
  }

  renderResultSummary(
    args: z.infer<typeof parameters>,
    result: unknown,
  ): string {
    const text =
      args.text.length > 60 ? args.text.slice(0, 57) + '...' : args.text;
    if (result == null || typeof result !== 'object') {
      return `[tts] text='${text}' (${args.voice})`;
    }
    const r = result as { size?: number; format?: string };
    return `[tts] text='${text}' (${args.voice}, ${r.format ?? args.format}) -> ${r.size ?? 0} bytes`;
  }
}
