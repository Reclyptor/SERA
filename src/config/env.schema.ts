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
    MEMORY_COLLECTION: z.string().default('sera_memories'),
    MEMORY_DECAY_TAU_DAYS: z.coerce.number().positive().default(90),
    MEMORY_CONFIDENCE_WEIGHT: z.coerce.number().min(0).max(1).default(0.5),
    MEMORY_RERANK_ENABLED: z.string().default('true'),
    MEMORY_RERANK_MODEL: z.string().default('anthropic/claude-haiku-4-5'),
    MEMORY_PREFETCH_LIMIT: z.coerce.number().int().positive().default(50),
    MEMORY_CONTEXT_LIMIT: z.coerce.number().int().positive().default(5),
    MEMORY_SEARCH_LIMIT: z.coerce.number().int().positive().default(10),
    MEMORY_CONSOLIDATION_INTERVAL_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(86_400_000),
    MEMORY_STALE_DAYS: z.coerce.number().int().positive().default(30),
    MEMORY_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.1),
    MEMORY_DUPLICATE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.95),
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

    // ── Volition & Proactive Companionship (§30) ────────────────────
    HEARTBEAT_IDLE_SENTINEL: z.string().default('SERA_IDLE'),
    INTENTION_EXTRACTION_ENABLED: z.string().default('true'),
    INTENTION_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
    PROACTIVE_MAX_PER_DAY: z.coerce.number().int().nonnegative().default(6),
    PROACTIVE_ACTIVE_HOURS_ENFORCED: z.string().default('true'),
    AUTONOMOUS_REFLECTION_ENABLED: z.string().default('true'),
    AUTONOMOUS_JUDGE_ENABLED: z.string().default('true'),
    AUTONOMOUS_JUDGE_MODEL: z.string().default('anthropic/claude-haiku-4-5'),
    AUTONOMOUS_MAX_TURNS: z.coerce.number().int().nonnegative().default(6),
    DREAMING_ENABLED: z.string().default('true'),
    DREAMING_INTERVAL_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(86_400_000),
    DREAMING_LOOKBACK_HOURS: z.coerce.number().int().positive().default(24),
    DREAMING_MAX_INSIGHTS: z.coerce.number().int().positive().default(3),
    DREAMING_MODEL: z.string().default('anthropic/claude-haiku-4-5'),
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
