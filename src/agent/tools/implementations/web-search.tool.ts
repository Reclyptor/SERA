import { z } from 'zod';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../tool.interface';

const parameters = z.object({
  query: z.string().describe('Search query'),
  maxResults: z.number().optional().default(5).describe('Number of results (1-10)'),
});

/**
 * Web search tool using a configurable search API.
 * Defaults to a fetch-based approach against a search endpoint.
 */
export class WebSearchTool implements Tool<typeof parameters> {
  readonly name = 'web_search';
  readonly description =
    'Search the web for current information. Returns search results with titles, URLs, and snippets.';
  readonly parameters = parameters;

  constructor(private readonly apiKey?: string) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { query, maxResults } = args;

    // If Tavily API key is available, use it
    if (this.apiKey) {
      return this.searchWithTavily(query, maxResults);
    }

    return {
      success: false,
      error:
        'No search API configured. Set TAVILY_API_KEY to enable web search.',
    };
  }

  private async searchWithTavily(
    query: string,
    maxResults: number,
  ): Promise<ToolExecutionResult> {
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          max_results: Math.min(maxResults, 10),
          include_answer: true,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Search API returned ${response.status}: ${response.statusText}`,
        };
      }

      const data = (await response.json()) as {
        answer?: string;
        results?: Array<{
          title: string;
          url: string;
          content: string;
        }>;
      };

      return {
        success: true,
        result: {
          answer: data.answer,
          results:
            data.results?.map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.content?.slice(0, 500),
            })) ?? [],
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Search request failed',
      };
    }
  }
}
