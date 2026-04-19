import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const parameters = z.object({
  query: z.string().describe('Search query. Supports X search operators.'),
  maxResults: z
    .number()
    .min(10)
    .max(100)
    .optional()
    .default(10)
    .describe('Number of results'),
  sortOrder: z
    .enum(['recency', 'relevancy'])
    .optional()
    .default('recency')
    .describe('Sort order'),
});

interface XUser {
  id: string;
  name: string;
  username: string;
}

interface XTweet {
  id: string;
  text: string;
  author_id: string;
  created_at?: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
  };
}

interface XSearchResponse {
  data?: XTweet[];
  includes?: { users?: XUser[] };
  meta?: { result_count: number };
}

export class XSearchTool implements Tool<typeof parameters> {
  readonly name = 'x_search';
  readonly parallelSafe = true;
  readonly description =
    'Search X (Twitter) for posts and discussions. Requires X_API_BEARER_TOKEN to be configured.';
  readonly parameters = parameters;

  constructor(private readonly bearerToken?: string) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.bearerToken) {
      return {
        success: false,
        error:
          'X search not configured. Set X_API_BEARER_TOKEN to enable.',
      };
    }

    const { query, maxResults, sortOrder } = args;

    const params = new URLSearchParams({
      query,
      max_results: String(maxResults),
      sort_order: sortOrder,
      'tweet.fields': 'created_at,author_id,public_metrics,text',
      expansions: 'author_id',
      'user.fields': 'name,username',
    });

    try {
      const response = await fetch(
        `https://api.twitter.com/2/tweets/search/recent?${params}`,
        {
          headers: { Authorization: `Bearer ${this.bearerToken}` },
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          success: false,
          error: `X API returned ${response.status}: ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
        };
      }

      const data = (await response.json()) as XSearchResponse;
      const usersById = new Map(
        (data.includes?.users ?? []).map((u) => [u.id, u]),
      );

      const results = (data.data ?? []).map((tweet) => {
        const user = usersById.get(tweet.author_id);
        return {
          id: tweet.id,
          text: tweet.text,
          authorId: tweet.author_id,
          authorName: user?.name,
          authorUsername: user?.username,
          createdAt: tweet.created_at,
          metrics: {
            likes: tweet.public_metrics?.like_count ?? 0,
            retweets: tweet.public_metrics?.retweet_count ?? 0,
            replies: tweet.public_metrics?.reply_count ?? 0,
          },
        };
      });

      return {
        success: true,
        result: {
          query,
          resultCount: results.length,
          results,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'X search failed',
      };
    }
  }
}
