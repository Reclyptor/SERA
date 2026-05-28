import { z } from 'zod';

/**
 * Canonical schema for SERA's environment configuration. Matches SPEC
 * §2 (Required + Optional). Used by `ConfigModule.forRoot({ validate })`
 * so the app fails fast at boot rather than degrading at first traffic
 * when a required variable is missing or malformed.
 */
const envSchema = z
  .object({
    // ── Required ────────────────────────────────────────────────────
    AUTH_SECRET: z.string().min(1),
    ANTHROPIC_API_KEY: z.string().min(1),
    PRIMARY_MODEL: z
      .string()
      .min(1)
      .describe('provider/model format, e.g. anthropic/claude-sonnet-4-6'),
    CORS_ORIGIN: z.string().min(1),
    AUTHENTIK_ISSUER: z.string().min(1),
    AUTHENTIK_CLIENT_ID: z.string().min(1),
    MONGODB_URI: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1),
    OBJECT_STORAGE_BUCKET: z.string().min(1),
    REDIS_URL: z.string().min(1),
    WEBHOOK_API_KEY: z.string().min(1),
    NTFY_API_URL: z.string().min(1),
    NTFY_API_TOKEN: z
      .string()
      .regex(/^tk_/, 'NTFY_API_TOKEN must start with tk_'),
    NTFY_API_TOPIC: z.string().min(1),

    // ── Optional with SPEC-documented defaults ──────────────────────
    PORT: z.coerce.number().int().positive().default(3001),
    FALLBACK_MODELS: z.string().optional(),
    OBJECT_STORAGE_ENDPOINT: z.string().optional(),
    ANTHROPIC_API_KEYS: z.string().optional(),
    OPENAI_API_KEYS: z.string().optional(),
    GOOGLE_API_KEY: z.string().optional(),
    GOOGLE_API_KEYS: z.string().optional(),
    ANTHROPIC_KEY_STRATEGY: z
      .enum(['round_robin', 'least_used', 'random'])
      .default('round_robin'),
    OPENAI_KEY_STRATEGY: z
      .enum(['round_robin', 'least_used', 'random'])
      .default('round_robin'),
    GOOGLE_KEY_STRATEGY: z
      .enum(['round_robin', 'least_used', 'random'])
      .default('round_robin'),
    ANTHROPIC_THINKING_ENABLED: z.string().default('true'),
    ANTHROPIC_THINKING_BUDGET: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(10000),
    VLLM_URL: z.string().optional(),
    ANTHROPIC_CONTEXT_WINDOW: z.coerce
      .number()
      .int()
      .positive()
      .default(200000),
    OPENAI_CONTEXT_WINDOW: z.coerce.number().int().positive().default(128000),
    GOOGLE_CONTEXT_WINDOW: z.coerce.number().int().positive().default(1000000),
    VLLM_CONTEXT_WINDOW: z.coerce.number().int().positive().default(131072),
    BRAVE_SEARCH_API_KEY: z.string().optional(),
    X_API_BEARER_TOKEN: z.string().optional(),
    QDRANT_URL: z
      .string()
      .default('http://qdrant.qdrant.svc.cluster.local:6333'),
    QDRANT_API_KEY: z.string().optional(),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    KNOWLEDGE_CHUNK_SIZE: z.coerce.number().int().positive().default(1000),
    KNOWLEDGE_CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(200),
    GITHUB_PAT: z.string().optional(),
    GITHUB_PROMPTS_REPO: z.string().default('Reclyptor/Prompts'),
    GITHUB_SKILLS_REPO: z.string().default('Reclyptor/Skills'),
    SKILL_CURATOR_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(21_600_000),
    SKILL_CURATOR_MODEL: z.string().default('anthropic/claude-sonnet-4-6'),
    SKILL_REVIEW_MODEL: z.string().optional(),
    SKILL_REVIEW_TURN_THRESHOLD: z.coerce.number().int().positive().default(3),
    SKILL_REVIEW_TOOL_THRESHOLD: z.coerce.number().int().positive().default(5),
    CREDENTIAL_COOLDOWN_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60_000),
    WORKSPACE_DIR: z.string().optional(),
    ENABLE_SHELL_TOOL: z.string().default('false'),
    AUTONOMOUS_WALL_CLOCK_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(180_000),
    MEMORY_NUDGE_INTERVAL: z.coerce.number().int().nonnegative().default(10),
    CRON_SCRIPT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    SCHEDULED_EXECUTION_LEASE_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(300_000),
    SCHEDULED_EXECUTION_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .positive()
      .default(3),
    COMMITMENT_EXTRACTION_ENABLED: z.string().default('true'),
  })
  // Allow unknown env vars (HOME, PATH, NODE_ENV, AWS_* for object
  // storage credential chain, CI vars, etc.) through unchanged. Strict
  // mode would reject anything the schema doesn't list.
  .passthrough();

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.errors
      .map((e) => `  - ${e.path.join('.') || '(root)'}: ${e.message}`)
      .join('\n');
    throw new Error(
      `Environment validation failed. Fix the following before booting:\n${issues}`,
    );
  }
  return result.data;
}
