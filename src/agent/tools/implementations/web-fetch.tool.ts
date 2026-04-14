import { z } from 'zod';
import { validateUrl } from '../security/url-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const MAX_RESPONSE_SIZE = 100 * 1024; // 100KB

const parameters = z.object({
  url: z.string().describe('Target URL'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    .optional()
    .default('GET')
    .describe('HTTP method'),
  headers: z.record(z.string()).optional().describe('Request headers'),
  body: z
    .union([z.string(), z.record(z.unknown())])
    .optional()
    .describe('Request body'),
  timeoutMs: z
    .number()
    .optional()
    .default(30000)
    .describe('Timeout in milliseconds'),
});

export class WebFetchTool implements Tool<typeof parameters> {
  readonly name = 'web_fetch';
  readonly description =
    'Fetch content from web URLs. Supports all HTTP methods with headers and body. Use for API calls and retrieving web page content.';
  readonly parameters = parameters;

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { url, method, headers, body, timeoutMs } = args;

    const validation = validateUrl(url);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      const requestHeaders: Record<string, string> = { ...headers };
      let requestBody: string | undefined;

      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        if (typeof body === 'string') {
          requestBody = body;
        } else {
          requestBody = JSON.stringify(body);
          requestHeaders['Content-Type'] ??= 'application/json';
        }
      }

      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        return {
          success: true,
          result: {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers),
            body: `[Response too large: ${contentLength} bytes. Max: ${MAX_RESPONSE_SIZE} bytes]`,
            truncated: true,
          },
        };
      }

      const text = await response.text();
      const truncated = text.length > MAX_RESPONSE_SIZE;
      const responseBody = truncated
        ? text.slice(0, MAX_RESPONSE_SIZE) + '\n[...truncated]'
        : text;

      let parsedBody: unknown = responseBody;
      try {
        parsedBody = JSON.parse(responseBody);
      } catch {
        // Keep as text
      }

      return {
        success: true,
        result: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers),
          body: parsedBody,
          truncated,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Fetch request failed',
      };
    }
  }
}
