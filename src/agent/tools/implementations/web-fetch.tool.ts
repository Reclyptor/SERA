import { z } from 'zod';
import { Agent } from 'undici';
import { validateUrl } from '../security/url-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolResource,
} from '../tool.interface';

const MAX_RESPONSE_SIZE = 100 * 1024; // 100KB
const MAX_REDIRECTS = 5;

// Headers that carry credentials or session state. Stripped on
// cross-origin redirects so a malicious target can't capture them by
// Location-redirecting to an attacker-controlled host.
const CROSS_ORIGIN_STRIPPED_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'www-authenticate',
]);

export function normalizeHeaders(
  headers: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k] = v;
    return out;
  }
  for (const [k, v] of Object.entries(headers)) {
    out[k] = v;
  }
  return out;
}

export function stripCredentialHeaders(
  headers: HeadersInit | undefined,
): Record<string, string> | undefined {
  const normalized = normalizeHeaders(headers);
  if (!normalized) return undefined;
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(normalized)) {
    if (!CROSS_ORIGIN_STRIPPED_HEADERS.has(k.toLowerCase())) {
      safe[k] = v;
    }
  }
  return safe;
}

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

  /**
   * Validates each redirect hop, pins the outbound TCP connection to an
   * IP address resolved during validation (defeating DNS rebind between
   * validation and connect), and strips credential-carrying headers on
   * cross-origin redirects so they cannot leak to an attacker-chosen
   * Location.
   */
  private async guardedFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    let currentUrl = url;
    let currentInit: RequestInit = init;
    let currentOrigin = new URL(url).origin;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const validation = await validateUrl(currentUrl);
      if (!validation.valid) {
        throw new Error(validation.error ?? 'URL blocked');
      }

      const dispatcher = this.buildPinnedDispatcher(validation.addresses);

      const response = await fetch(currentUrl, {
        ...currentInit,
        redirect: 'manual',
        // Node 18+ global `fetch` honors undici's `dispatcher` field.
        ...(dispatcher ? { dispatcher } : {}),
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }

      const location = response.headers.get('location');
      if (!location) return response;

      const nextUrl = new URL(location, currentUrl).toString();
      const nextOrigin = new URL(nextUrl).origin;

      // Cross-origin redirect: rebuild headers without credentials.
      const nextHeaders =
        nextOrigin !== currentOrigin
          ? stripCredentialHeaders(currentInit.headers)
          : normalizeHeaders(currentInit.headers);

      currentUrl = nextUrl;
      currentOrigin = nextOrigin;
      if (response.status === 303) {
        // Per RFC 7231: 303 downgrades to GET and drops the body.
        currentInit = {
          ...currentInit,
          method: 'GET',
          body: undefined,
          headers: nextHeaders,
        };
      } else {
        currentInit = { ...currentInit, headers: nextHeaders };
      }
    }

    throw new Error('Too many redirects');
  }

  private buildPinnedDispatcher(
    addresses: ReadonlyArray<{ address: string; family: number }> | undefined,
  ): Agent | undefined {
    const pinned = addresses?.[0];
    if (!pinned) return undefined;
    return new Agent({
      connect: {
        // Force every DNS resolution from the dispatcher's connect path
        // to return the address we already validated. TLS SNI still uses
        // the URL hostname, so cert verification is unaffected.
        lookup: (_host, _opts, cb) => {
          cb(null, pinned.address, pinned.family);
        },
      },
    });
  }

  renderResultSummary(
    args: z.infer<typeof parameters>,
    result: unknown,
  ): string {
    if (result == null || typeof result !== 'object') {
      return `[web_fetch] ${args.url}`;
    }
    const r = result as { status?: number; body?: unknown };
    const body =
      typeof r.body === 'string'
        ? r.body
        : (JSON.stringify(r.body ?? '') ?? '');
    return `[web_fetch] ${args.url} -> ${r.status ?? '?'} (${body.length} chars)`;
  }
}
