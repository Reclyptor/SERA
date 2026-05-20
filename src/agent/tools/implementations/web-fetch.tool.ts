import { z } from 'zod';
import { validateUrl } from '../security/url-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolResource,
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
  readonly parallelSafe = true;
  readonly description =
    'Fetch content from web URLs. Supports all HTTP methods with headers and body. Use for API calls and retrieving web page content.';
  readonly parameters = parameters;

  getResources(args: z.infer<typeof parameters>): ToolResource[] {
    try {
      return [{ type: 'network', host: new URL(args.url).hostname }];
    } catch {
      return [];
    }
  }

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { url, method, headers, body, timeoutMs } = args;

    const validation = await validateUrl(url);
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

      const response = await this.guardedFetch(url, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: this.buildSignal(timeoutMs, _context.abortSignal),
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

  private buildSignal(
    timeoutMs: number,
    abortSignal?: AbortSignal,
  ): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return abortSignal
      ? AbortSignal.any([timeoutSignal, abortSignal])
      : timeoutSignal;
  }

  private async guardedFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    let currentUrl = url;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const validation = await validateUrl(currentUrl);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const response = await fetch(currentUrl, {
        ...init,
        redirect: 'manual',
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }

      const location = response.headers.get('location');
      if (!location) return response;
      currentUrl = new URL(location, currentUrl).toString();
      if (response.status === 303) {
        init = { ...init, method: 'GET', body: undefined };
      }
    }

    throw new Error('Too many redirects');
  }
}
