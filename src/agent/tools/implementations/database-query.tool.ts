import { z } from 'zod';
import { Connection } from 'mongoose';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const MAX_RESULTS = 100;

const ALLOWED_COLLECTIONS = new Set([
  'threads',
  'runs',
  'agentstates',
]);

const parameters = z.object({
  collection: z.string().describe('MongoDB collection name'),
  operation: z
    .enum(['find', 'findOne', 'count', 'distinct', 'aggregate'])
    .describe('Query operation (read-only)'),
  filter: z
    .record(z.unknown())
    .optional()
    .default({})
    .describe('MongoDB query filter'),
  projection: z
    .record(z.number())
    .optional()
    .describe('Fields to include (1) or exclude (0)'),
  sort: z.record(z.number()).optional().describe('Sort order'),
  limit: z
    .number()
    .optional()
    .default(20)
    .describe(`Max results (capped at ${MAX_RESULTS})`),
  pipeline: z
    .array(z.record(z.unknown()))
    .optional()
    .describe('Aggregation pipeline (for aggregate operation)'),
  field: z.string().optional().describe('Field name (for distinct operation)'),
});

export class DatabaseQueryTool implements Tool<typeof parameters> {
  readonly name = 'database_query';
  readonly description =
    'Run read-only queries against the MongoDB database. Supports find, findOne, count, distinct, and aggregate.';
  readonly parameters = parameters;

  constructor(private readonly connection: Connection) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const {
      collection,
      operation,
      filter,
      projection,
      sort,
      limit,
      pipeline,
      field,
    } = args;

    if (!ALLOWED_COLLECTIONS.has(collection)) {
      return {
        success: false,
        error: `Collection "${collection}" is not queryable. Allowed: ${[...ALLOWED_COLLECTIONS].join(', ')}`,
      };
    }

    const cappedLimit = Math.min(limit, MAX_RESULTS);

    try {
      const col = this.connection.collection(collection);
      let result: unknown;

      switch (operation) {
        case 'find':
          result = await col
            .find(filter, { projection })
            .sort((sort ?? {}) as Record<string, 1 | -1>)
            .limit(cappedLimit)
            .toArray();
          break;

        case 'findOne':
          result = await col.findOne(filter, { projection });
          break;

        case 'count':
          result = await col.countDocuments(filter);
          break;

        case 'distinct':
          if (!field) {
            return {
              success: false,
              error: 'Field is required for distinct operation',
            };
          }
          result = await col.distinct(field, filter);
          break;

        case 'aggregate':
          if (!pipeline || pipeline.length === 0) {
            return {
              success: false,
              error: 'Pipeline is required for aggregate operation',
            };
          }
          // Inject a $limit stage if not present
          const hasLimit = pipeline.some((stage) => '$limit' in stage);
          const safePipeline = hasLimit
            ? pipeline
            : [...pipeline, { $limit: cappedLimit }];
          result = await col.aggregate(safePipeline).toArray();
          break;
      }

      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Database query failed',
      };
    }
  }
}
