import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const parameters = z.object({
  query: z
    .string()
    .describe(
      'Search query. Supports operators: "exact match", -exclude, site:domain.com, filetype:pdf',
    ),
  maxResults: z
    .number()
    .optional()
    .default(5)
    .describe('Number of results (1-20)'),
  freshness: z
    .enum(['24h', '7d', '31d', '1y', 'any'])
    .optional()
    .default('any')
    .describe('Filter results by age'),
  type: z
    .enum(['web', 'news'])
    .optional()
    .default('web')
    .describe('Search type: general web or news articles'),
});

const FRESHNESS_MAP: Record<string, string | undefined> = {
  '24h': 'pd',
  '7d': 'pw',
  '31d': 'pm',
  '1y': 'py',
  any: undefined,
};

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  extra_snippets?: string[];
  page_age?: string;
  language?: string;
}

interface BraveNewsResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  meta_url?: { hostname?: string };
}

interface BraveSearchResponse {
  query?: { original: string; more_results_available: boolean };
  web?: { results: BraveWebResult[] };
  news?: { results: BraveNewsResult[] };
}

export class WebSearchTool implements Tool<typeof parameters> {
  readonly name = 'web_search';
  readonly description =
    'Search the web for current information using Brave Search. Returns results with titles, URLs, and descriptions. Supports freshness filtering, news search, and search operators like "exact match", -exclude, site:domain.com.';
  readonly parameters = parameters;

  private readonly baseUrl = 'https://api.search.brave.com/res/v1';

  constructor(private readonly apiKey?: string) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error:
          'No search API configured. Set BRAVE_SEARCH_API_KEY to enable web search.',
      };
    }

    const { query, maxResults, freshness, type } = args;

    return type === 'news'
      ? this.searchNews(query, maxResults, freshness)
      : this.searchWeb(query, maxResults, freshness);
  }

  private async searchWeb(
    query: string,
    count: number,
    freshness: string,
  ): Promise<ToolExecutionResult> {
    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(count, 20)),
      extra_snippets: 'true',
    });

    const mapped = FRESHNESS_MAP[freshness];
    if (mapped) params.set('freshness', mapped);

    try {
      const response = await fetch(`${this.baseUrl}/web/search?${params}`, {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey!,
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          success: false,
          error: `Brave Search returned ${response.status}: ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
        };
      }

      const data = (await response.json()) as BraveSearchResponse;
      const results = (data.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        ...(r.extra_snippets?.length && { extraSnippets: r.extra_snippets }),
        ...(r.page_age && { age: r.page_age }),
      }));

      return {
        success: true,
        result: {
          query: data.query?.original ?? query,
          resultCount: results.length,
          moreAvailable: data.query?.more_results_available ?? false,
          results,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Web search failed',
      };
    }
  }

  private async searchNews(
    query: string,
    count: number,
    freshness: string,
  ): Promise<ToolExecutionResult> {
    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(count, 20)),
    });

    const mapped = FRESHNESS_MAP[freshness];
    if (mapped) params.set('freshness', mapped);

    try {
      const response = await fetch(`${this.baseUrl}/news/search?${params}`, {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey!,
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          success: false,
          error: `Brave News Search returned ${response.status}: ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
        };
      }

      const data = (await response.json()) as BraveSearchResponse;
      const results = (data.news?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        ...(r.age && { age: r.age }),
        ...(r.meta_url?.hostname && { source: r.meta_url.hostname }),
      }));

      return {
        success: true,
        result: {
          query: data.query?.original ?? query,
          resultCount: results.length,
          moreAvailable: data.query?.more_results_available ?? false,
          results,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'News search failed',
      };
    }
  }
}
