# SERA Application Specification

> **Version:** 1.2
> **Last Updated:** 2026-05-29
> **Source of Truth** for architecture, data models, API surface, and runtime behavior.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Environment & Configuration](#2-environment--configuration)
3. [Authentication](#3-authentication)
4. [Data Model](#4-data-model)
5. [API Surface](#5-api-surface)
6. [Orchestration Engine](#6-orchestration-engine)
7. [Model Router](#7-model-router)
8. [Streaming & Events](#8-streaming--events)
9. [Context Management](#9-context-management)
10. [Tool System](#10-tool-system)
11. [Agent Configuration](#11-agent-configuration)
12. [Actions System](#12-actions-system)
13. [Memory System](#13-memory-system)
14. [Knowledge System](#14-knowledge-system)
15. [Skills System](#15-skills-system)
16. [Plugins System](#16-plugins-system)
17. [MCP Integration](#17-mcp-integration)
18. [Task Planning](#18-task-planning)
19. [Triggers & Webhooks](#19-triggers--webhooks)
20. [Cron Scheduling](#20-cron-scheduling)
21. [Heartbeat System](#21-heartbeat-system)
22. [Usage Insights](#22-usage-insights)
23. [Security](#23-security)
24. [Chat Management](#24-chat-management)
25. [Prompt Management](#25-prompt-management)
26. [GitHub Sync](#26-github-sync)
27. [Storage](#27-storage)
28. [Autonomy Features](#28-autonomy-features)
29. [Agent Maturity Implementation Plan](#29-agent-maturity-implementation-plan)
30. [Appendix A: Deployment](#appendix-a-deployment)
31. [Appendix B: State Snapshot](#appendix-b-state-snapshot)
32. [Appendix C: SyncResult](#appendix-c-syncresult)
33. [Appendix D: Test Tooling](#appendix-d-test-tooling)

---

## 1. System Overview

SERA is an agentic AI backend that orchestrates LLM-powered agents with tool use, memory, knowledge retrieval, skill learning, and multi-agent coordination. It is one component of a three-part system:

| Component            | Framework          | Role                       |
| -------------------- | ------------------ | -------------------------- |
| **SERA** (this spec) | NestJS (Node.js)   | Backend API server         |
| **SERAUI**           | Next.js            | Frontend web application   |
| **SERAEX**           | Temporal (Node.js) | Background workflow worker |

### Runtime

- **Language:** TypeScript (ES2023 target)
- **Framework:** NestJS 11 on Express
- **Database:** MongoDB (Mongoose 9)
- **Cache / Pub-Sub / Streams:** Redis (ioredis)
- **Vector Store:** Qdrant
- **LLM SDK:** Vercel AI SDK (`ai` package)
- **Container:** Node 24 Alpine, non-root user, port 3001
- **Global API Prefix:** `/api/v1` (except `/health`)
- **Body Limit:** 50 MB (JSON, URL-encoded, and `text/*`)
- **CORS:** Configurable origin, credentials enabled, allowed headers: `Content-Type`, `Cookie`

### Module Dependency Graph

```
AppModule
  +-- AuthModule (global guard: SessionAuthGuard)
  +-- RedisModule (global)
  +-- GitHubModule (global)
  +-- ChatsModule
  +-- PromptsModule
  +-- AgentsModule
  +-- SkillsModule
  +-- AgentModule
        +-- OrchestrationModule
        |     +-- ModelModule
        |     +-- ToolsModule
        |     +-- ActionsModule
        |     +-- StateModule
        |     +-- MemoryModule
        |     +-- KnowledgeModule
        |     +-- ContextModule
        |     +-- StreamingModule
        |     +-- PromptsModule
        |     +-- ChatsModule
        |     +-- AgentsModule
        |     +-- SkillsModule
        |     +-- SandboxModule
        |     +-- InsightsModule
        |     +-- CommitmentsModule
        +-- HeartbeatModule
        +-- CronModule
        +-- TasksModule
        +-- TriggersModule
        +-- McpModule
        +-- PluginsModule
        +-- InsightsModule
        +-- SandboxModule
```

---

## 2. Environment & Configuration

### Required Variables

| Variable                | Description                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `AUTH_SECRET`           | Secret for decrypting Auth.js session cookies                                       |
| `ANTHROPIC_API_KEY`     | Anthropic API key (or first key in pool)                                            |
| `PRIMARY_MODEL`         | Default model in `provider/model` format (e.g., `anthropic/claude-sonnet-4-6`)      |
| `CORS_ORIGIN`           | Allowed CORS origin                                                                 |
| `AUTHENTIK_ISSUER`      | OIDC issuer URL for token validation                                                |
| `AUTHENTIK_CLIENT_ID`   | OIDC client ID for audience validation                                              |
| `MONGODB_URI`           | MongoDB connection string                                                           |
| `OPENAI_API_KEY`        | OpenAI API key (or first key in pool)                                               |
| `OBJECT_STORAGE_BUCKET` | S3-compatible bucket for durable attachments                                        |
| `REDIS_URL`             | Redis connection URL                                                                |
| `WEBHOOK_API_KEY`       | Shared API key required by webhook ingress                                          |
| `NTFY_API_URL`          | ntfy server base URL (trailing slashes stripped) for push notifications             |
| `NTFY_API_TOKEN`        | ntfy bearer access token (must start with `tk_`); mint via `POST /v1/account/token` |
| `NTFY_API_TOPIC`        | ntfy topic that `send_push_notification` publishes to                               |

### Optional Variables

| Variable                           | Default                                       | Description                                                                   |
| ---------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| `PORT`                             | `3001`                                        | Server listen port                                                            |
| `FALLBACK_MODELS`                  | _(none)_                                      | Comma-separated fallback models in `provider/model` format                    |
| `OBJECT_STORAGE_ENDPOINT`          | _(unset)_                                     | S3-compatible endpoint; set for MinIO, omit for AWS S3                        |
| `ANTHROPIC_API_KEYS`               | _(none)_                                      | Comma-separated key pool                                                      |
| `OPENAI_API_KEYS`                  | _(none)_                                      | Comma-separated key pool                                                      |
| `GOOGLE_API_KEY`                   | _(none)_                                      | Google AI API key                                                             |
| `GOOGLE_API_KEYS`                  | _(none)_                                      | Comma-separated key pool                                                      |
| `ANTHROPIC_KEY_STRATEGY`           | `round_robin`                                 | Key rotation: `round_robin`, `least_used`, `random`                           |
| `OPENAI_KEY_STRATEGY`              | `round_robin`                                 | Key rotation strategy                                                         |
| `GOOGLE_KEY_STRATEGY`              | `round_robin`                                 | Key rotation strategy                                                         |
| `ANTHROPIC_THINKING_ENABLED`       | `true`                                        | Enable extended thinking                                                      |
| `ANTHROPIC_THINKING_BUDGET`        | `10000`                                       | Max thinking tokens                                                           |
| `VLLM_URL`                         | _(none)_                                      | vLLM-compatible endpoint base URL (trailing slashes stripped, `/v1` appended) |
| `ANTHROPIC_CONTEXT_WINDOW`         | `200000`                                      | Anthropic context window size                                                 |
| `OPENAI_CONTEXT_WINDOW`            | `128000`                                      | OpenAI context window size                                                    |
| `GOOGLE_CONTEXT_WINDOW`            | `1000000`                                     | Google context window size                                                    |
| `VLLM_CONTEXT_WINDOW`              | `131072`                                      | vLLM context window size                                                      |
| `BRAVE_SEARCH_API_KEY`             | _(none)_                                      | Brave Search API key                                                          |
| `X_API_BEARER_TOKEN`               | _(none)_                                      | X/Twitter API bearer token                                                    |
| `QDRANT_URL`                       | `http://qdrant.qdrant.svc.cluster.local:6333` | Qdrant vector DB URL                                                          |
| `QDRANT_API_KEY`                   | _(none)_                                      | Qdrant authentication key                                                     |
| `OPENAI_EMBEDDING_MODEL`           | `text-embedding-3-small`                      | Embedding model for knowledge/memory                                          |
| `KNOWLEDGE_CHUNK_SIZE`             | `1000`                                        | Document chunk size in chars                                                  |
| `KNOWLEDGE_CHUNK_OVERLAP`          | `200`                                         | Chunk overlap in chars                                                        |
| `GITHUB_PAT`                       | _(none)_                                      | GitHub Personal Access Token                                                  |
| `GITHUB_PROMPTS_REPO`              | `Reclyptor/Prompts`                           | GitHub repo for prompts                                                       |
| `GITHUB_SKILLS_REPO`               | `Reclyptor/Skills`                            | GitHub repo for skills                                                        |
| `SKILL_CURATOR_INTERVAL_MS`        | `21600000` (6h)                               | Skill curation cycle interval                                                 |
| `SKILL_CURATOR_MODEL`              | `anthropic/claude-sonnet-4-6`                 | Model for skill curation                                                      |
| `SKILL_REVIEW_MODEL`               | _(none)_                                      | Model for skill review (optional override)                                    |
| `SKILL_REVIEW_TURN_THRESHOLD`      | `3`                                           | Turns before triggering skill review                                          |
| `SKILL_REVIEW_TOOL_THRESHOLD`      | `5`                                           | Tool calls before triggering skill review                                     |
| `CREDENTIAL_COOLDOWN_MS`           | `60000`                                       | Cooldown applied to a provider key after a rotate-required error              |
| `WORKSPACE_DIR`                    | `process.cwd()`                               | Workspace root exposed to file/runtime tools                                  |
| `ENABLE_SHELL_TOOL`                | `false`                                       | Enables `exec`, `shell`, `process`, and `code_execution` runtime tools        |
| `AUTONOMOUS_WALL_CLOCK_TIMEOUT_MS` | `180000`                                      | Wall-clock timeout (ms) for autonomous runs (cron/heartbeat/webhook)          |
| `MEMORY_NUDGE_INTERVAL`            | `10`                                          | Tool calls between memory-save nudge injections (0 = disabled)                |
| `MEMORY_COLLECTION`                | `sera_memories`                               | Qdrant collection name for the native memory backend                          |
| `MEMORY_DECAY_TAU_DAYS`            | `90`                                          | Recency decay time constant in days                                           |
| `MEMORY_CONFIDENCE_WEIGHT`         | `0.5`                                         | Blend `[0,1]` between flat and confidence-weighted score                      |
| `MEMORY_RERANK_ENABLED`            | `true`                                        | Enable LLM rerank in `getContextForQuery`                                     |
| `MEMORY_RERANK_MODEL`              | `anthropic/claude-haiku-4-5`                  | Provider/model used by `MemoryReranker`                                       |
| `MEMORY_PREFETCH_LIMIT`            | `50`                                          | Qdrant prefetch candidates per branch (dense / sparse) before RRF             |
| `MEMORY_CONTEXT_LIMIT`             | `5`                                           | Top-K returned by `getContextForQuery` after rerank                           |
| `MEMORY_SEARCH_LIMIT`              | `10`                                          | Default top-K returned by `MemoryService.search`                              |
| `MEMORY_CONSOLIDATION_INTERVAL_MS` | `86400000`                                    | Consolidator cycle period (default 24h). `0` disables the cycle.              |
| `MEMORY_STALE_DAYS`                | `30`                                          | Days of no read access before consolidator decays a memory                    |
| `MEMORY_MIN_CONFIDENCE`            | `0.1`                                         | Post-decay confidence floor below which a memory is expired                   |
| `MEMORY_DUPLICATE_THRESHOLD`       | `0.95`                                        | Cosine similarity at which two memories merge during consolidation            |
| `CRON_SCRIPT_TIMEOUT_MS`           | `10000`                                       | Max execution time (ms) for cron job pre-processing scripts                   |
| `SCHEDULED_EXECUTION_LEASE_MS`     | `300000`                                      | Lease duration for durable cron/heartbeat execution claims                    |
| `SCHEDULED_EXECUTION_MAX_ATTEMPTS` | `3`                                           | Max claim attempts for expired scheduled executions                           |
| `COMMITMENT_EXTRACTION_ENABLED`    | `true`                                        | Toggle LLM-based commitment extraction after runs                             |
| `SUMMARY_MODEL`                    | _(none)_                                      | Global default model for context compaction (`provider/model`); falls back to primary router |
| `MODEL_CONTEXT_WINDOWS`            | _(none)_                                      | JSON map of per-model context window overrides (e.g. `{"Qwen3.6-27B-FP8":131072}`)             |
| `CONTEXT_REFERENCES_ENABLED`       | `false`                                       | Enable `@file:`/`@diff`/`@staged`/`@url:` reference preprocessing on user messages            |
| `CONTEXT_SUMMARY_MAX_AGE_DAYS`     | `7`                                           | Days of inactivity before a persisted compaction summary is regenerated from scratch          |
| `CONTEXT_SUMMARY_MAX_GENERATIONS`  | `10`                                          | Hard cap on iterative summary merges before regeneration from scratch                         |
| `CONTEXT_COOLDOWN_MS`              | `600000`                                      | Cooldown applied to Tier 1 summarization after a failure                                      |
| `KUBECONFIG`                       | _(none)_                                      | **Raw kubeconfig YAML content** (not a file path) consumed by the `kubectl` tool. Unset disables the tool. |
| `KUBE_CONTEXT`                     | _(kubeconfig default)_                        | Optional context override for the `kubectl` tool                                              |
| `CLUSTER_REPO`                     | _(none)_                                      | `owner/repo` of the Flux-watched cluster repo edited by the `cluster_git` tool                |
| `CLUSTER_BRANCH`                   | `master`                                      | Branch the `cluster_git` tool writes to (Flux reconciles from this branch)                    |

Object storage intentionally uses the AWS SDK credential chain. For AWS S3, set `OBJECT_STORAGE_BUCKET` and rely on `AWS_REGION` plus IAM role, profile, or standard AWS credential environment variables. For MinIO, additionally set `OBJECT_STORAGE_ENDPOINT`; the client automatically uses path-style requests whenever an endpoint is provided.

### Redis Key Namespace

| Pattern                    | Type    | TTL                         | Purpose                                  |
| -------------------------- | ------- | --------------------------- | ---------------------------------------- |
| `prompt:{slug}`            | String  | 300s                        | Cached prompt content                    |
| `skill:{name}`             | String  | 300s                        | Cached skill document                    |
| `skill:{name}:file:{path}` | String  | 300s                        | Cached skill file                        |
| `agent:catalog`            | String  | 300s                        | Cached `AgentsService.findAll()`         |
| `agent:catalog:enabled`    | String  | 300s                        | Cached `AgentsService.findEnabled()`     |
| `agent:{agentID}`          | String  | 300s                        | Cached single `AgentConfig`              |
| `model:catalog`            | String  | 300s                        | Cached `ModelCatalogService.findAll()`   |
| `model:catalog:enabled`    | String  | 300s                        | Cached `ModelCatalogService.findEnabled` |
| `model:{spec}`             | String  | 300s                        | Cached single `ModelCatalogEntry`        |
| `github:sync:{repo}`       | String  | None                        | Last synced commit SHA                   |
| `run:{runID}:stream`       | Stream  | 1800s (300s after complete) | SSE event stream                         |
| `chat:{chatID}:activeRun`  | String  | 1800s                       | Active run tracking (JSON)               |
| `cancel:{runID}`           | Pub/Sub | N/A                         | Run cancellation channel                 |

---

## 3. Authentication

### Flow

1. The frontend (SERAUI / Next.js) authenticates users via Auth.js against an Authentik OIDC provider.
2. Auth.js stores a signed, encrypted session cookie (`authjs.session-token` or `__Secure-authjs.session-token`).
3. On every request, `SessionAuthGuard` intercepts and delegates to `SessionStrategy`.
4. `SessionStrategy` decrypts the cookie using HKDF-derived key from `AUTH_SECRET`, then validates the embedded access token JWT against Authentik's JWKS endpoint.
5. The validated user is attached to the request as a `SessionUser`.

### SessionUser

```typescript
interface SessionUser {
  sub: string; // User ID (from OIDC subject claim)
  email?: string;
  name?: string;
  groups?: string[];
}
```

### Cookie Decryption

- **Algorithm:** A256CBC-HS512
- **Key Derivation:** HKDF with SHA-256
  - Secret: `AUTH_SECRET` (UTF-8 encoded)
  - Salt: cookie name (e.g., `authjs.session-token`)
  - Info: `Auth.js Generated Encryption Key ({salt})`
  - Output: 512 bits (64 bytes)

### JWKS Validation

- Discovery via `{AUTHENTIK_ISSUER}/.well-known/openid-configuration`
- JWKS fetched from discovered `jwks_uri`
- JWKS result is cached after first fetch
- Token validated against issuer and audience (`AUTHENTIK_CLIENT_ID`)

### Public Routes

Endpoints decorated with `@Public()` bypass authentication. Current public routes:

- `GET /health`

### Decorators

| Decorator             | Target       | Purpose                                                                   |
| --------------------- | ------------ | ------------------------------------------------------------------------- |
| `@Public()`           | Method/Class | Bypasses `SessionAuthGuard`                                               |
| `@WebhookProtected()` | Method/Class | Bypasses session auth so a route-level `WebhookAuthGuard` can handle auth |
| `@CurrentUser()`      | Parameter    | Injects `SessionUser` from request                                        |
| `@CurrentUser('sub')` | Parameter    | Injects specific property of `SessionUser`                                |

---

## 4. Data Model

All schemas use Mongoose with `timestamps: true` unless noted. Fields marked `(auto)` are managed by Mongoose.

API responses are JSON-serialized Mongoose documents. Mongo `_id` values are exposed as strings, and `Date` values are exposed as ISO strings; embedded chat messages created optimistically by clients may still use local `Date` objects before persistence.

### 4.1 Chat

**Collection:** `chats`

| Field       | Type      | Required | Default | Index                                   |
| ----------- | --------- | -------- | ------- | --------------------------------------- |
| `userID`    | String    | Yes      |         | `userID: 1`, `userID: 1, updatedAt: -1` |
| `title`     | String    | Yes      |         | Text index                              |
| `model`     | String    | No       |         |                                         |
| `agentID`   | String    | No       |         |                                         |
| `messages`  | Message[] | No       | `[]`    | Text index on `messages.content`        |
| `createdAt` | Date      | (auto)   |         |                                         |
| `updatedAt` | Date      | (auto)   |         |                                         |

`model` and `agentID` are **sticky picker selections**. When set on the chat document, they default subsequent `POST /agent/chat` requests for that chat unless `body.model` / `body.agentID` overrides them. See §6 Execution Flow.

**Message** (embedded):

| Field              | Type                                | Required | Default    |
| ------------------ | ----------------------------------- | -------- | ---------- |
| `id`               | String                              | Yes      |            |
| `role`             | Enum: `user`, `assistant`, `system` | Yes      |            |
| `content`          | String                              | Yes      |            |
| `thinking`         | String                              | No       |            |
| `thinkingDuration` | Number                              | No       |            |
| `toolCalls`        | ToolCallBlock[]                     | No       |            |
| `attachments`      | MessageAttachment[]                 | No       | `[]`       |
| `createdAt`        | Date                                | No       | `Date.now` |

**ToolCallBlock** (embedded, `_id: false`):

| Field          | Type                                                | Required | Default   |
| -------------- | --------------------------------------------------- | -------- | --------- |
| `toolCallID`   | String                                              | Yes      |           |
| `toolName`     | String                                              | Yes      |           |
| `args`         | Mixed                                               | No       | `{}`      |
| `result`       | Mixed                                               | No       |           |
| `error`        | String                                              | No       |           |
| `status`       | Enum: `started`, `executing`, `completed`, `failed` | Yes      | `started` |
| `isSubagent`   | Boolean                                             | No       |           |
| `subagentMeta` | SubagentMeta                                        | No       |           |

**SubagentMeta** (embedded, `_id: false`):

| Field      | Type   | Required |
| ---------- | ------ | -------- |
| `runID`    | String | Yes      |
| `threadID` | String | Yes      |
| `agentID`  | String | Yes      |
| `goal`     | String | Yes      |

**MessageAttachment** (embedded, `_id: false`):

| Field       | Type                  | Required |
| ----------- | --------------------- | -------- |
| `id`        | String                | Yes      |
| `kind`      | Enum: `image`, `file` | Yes      |
| `mimeType`  | String                | Yes      |
| `size`      | Number                | Yes      |
| `filename`  | String                | No       |
| `createdAt` | Date                  | No       |

### 4.2 Prompt

**Collection:** `prompts`

| Field         | Type   | Required | Default | Index  |
| ------------- | ------ | -------- | ------- | ------ |
| `slug`        | String | Yes      |         | Unique |
| `extends`     | String | No       |         |        |
| `content`     | String | Yes      |         |        |
| `description` | String | No       |         |        |
| `seedHash`    | String | No       |         |        |
| `metadata`    | Object | No       | `{}`    |        |
| `createdAt`   | Date   | (auto)   |         |        |
| `updatedAt`   | Date   | (auto)   |         |        |

Prompts support inheritance via `extends`. Resolution walks the chain up to 10 levels, concatenating content with `\n\n`. Circular references are detected and rejected.

### 4.3 AgentConfig

**Collection:** `agents`

| Field             | Type            | Required | Default                                 | Index  |
| ----------------- | --------------- | -------- | --------------------------------------- | ------ |
| `agentID`         | String          | Yes      |                                         | Unique |
| `name`            | String          | Yes      |                                         |        |
| `description`     | String          | No       | `''`                                    |        |
| `promptSlug`      | String          | No       |                                         |        |
| `modelOptions`    | ModelOptions    | No       |                                         |        |
| `toolPolicy`      | ToolPolicy      | No       | `{ mode: 'deny', tools: [] }`           |        |
| `messagingPolicy` | MessagingPolicy | No       | `{ enabled: false, allowedAgents: [] }` |        |
| `sandboxConfig`   | SandboxConfig   | No       |                                         |        |
| `enabled`         | Boolean         | No       | `true`                                  |        |
| `createdAt`       | Date            | (auto)   |                                         |        |
| `updatedAt`       | Date            | (auto)   |                                         |        |

**ToolPolicy** (embedded):

| Field   | Type                  | Default |
| ------- | --------------------- | ------- |
| `mode`  | Enum: `allow`, `deny` | `deny`  |
| `tools` | String[]              | `[]`    |

When `mode` is `allow`, only listed tools are available. When `deny`, listed tools are blocked and all others are available. When `tools` array is empty, no filtering is applied regardless of mode — the agent gets the full tool set.

**ModelOptions** (embedded):

| Field               | Type   |
| ------------------- | ------ |
| `preferredProvider` | String |
| `preferredModel`    | String |
| `maxOutputTokens`   | Number |
| `temperature`       | Number |

**MessagingPolicy** (embedded):

| Field           | Type     | Default |
| --------------- | -------- | ------- |
| `enabled`       | Boolean  | `false` |
| `allowedAgents` | String[] | `[]`    |

**SandboxConfig** (embedded):

| Field            | Type    | Default        |
| ---------------- | ------- | -------------- |
| `enabled`        | Boolean | `false`        |
| `image`          | String  | `node:20-slim` |
| `memoryMb`       | Number  | `512`          |
| `cpuShares`      | Number  | `1024`         |
| `networkEnabled` | Boolean | `false`        |
| `envVars`        | Mixed   | `{}`           |

### 4.4 AgentBinding

**Collection:** `bindings`

| Field          | Type                               | Required | Default | Index  |
| -------------- | ---------------------------------- | -------- | ------- | ------ |
| `bindingID`    | String                             | Yes      |         | Unique |
| `agentID`      | String                             | Yes      |         | Yes    |
| `bindingType`  | Enum: `channel`, `user`, `default` | Yes      |         | Yes    |
| `bindingValue` | String                             | No       |         |        |
| `priority`     | Number                             | No       | `0`     |        |
| `enabled`      | Boolean                            | No       | `true`  |        |
| `createdAt`    | Date                               | (auto)   |         |        |
| `updatedAt`    | Date                               | (auto)   |         |        |

### 4.5 Thread

**Collection:** (default Mongoose name)

| Field       | Type       | Required | Default | Index  |
| ----------- | ---------- | -------- | ------- | ------ |
| `threadID`  | String     | Yes      |         | Unique |
| `toolCalls` | ToolCall[] | No       | `[]`    |        |
| `metadata`  | Mixed      | No       | `{}`    |        |
| `createdAt` | Date       | (auto)   |         |        |
| `updatedAt` | Date       | (auto)   |         |        |

**ToolCall** (embedded in Thread):

| Field       | Type                                                | Required | Default    |
| ----------- | --------------------------------------------------- | -------- | ---------- |
| `id`        | String                                              | Yes      |            |
| `name`      | String                                              | Yes      |            |
| `args`      | Mixed                                               | No       | `{}`       |
| `result`    | Mixed                                               | No       |            |
| `status`    | Enum: `pending`, `executing`, `completed`, `failed` | No       | `pending`  |
| `timestamp` | Date                                                | No       | `Date.now` |

### 4.6 Run

**Collection:** (default Mongoose name)

| Field         | Type                                                           | Required | Default    | Index  |
| ------------- | -------------------------------------------------------------- | -------- | ---------- | ------ |
| `runID`       | String                                                         | Yes      |            | Unique |
| `threadID`    | String                                                         | Yes      |            | Yes    |
| `status`      | Enum: `pending`, `running`, `completed`, `failed`, `cancelled` | No       | `pending`  |
| `startedAt`   | Date                                                           | No       | `Date.now` |        |
| `completedAt` | Date                                                           | No       |            |        |
| `error`       | String                                                         | No       |            |        |
| `response`    | String                                                         | No       |            |        |
| `userMessage` | String                                                         | No       | `''`       |        |
| `agentID`     | String                                                         | No       | `''`       |        |

Goal persistence: `userMessage` and `agentID` are stored on every run so failed runs can be retried or resumed without the original caller.

### 4.7 AgentState

**Collection:** `states`

| Field                  | Type                  | Required | Default | Index  |
| ---------------------- | --------------------- | -------- | ------- | ------ |
| `threadID`             | String                | Yes      |         | Unique |
| `custom`               | Mixed                 | No       | `{}`    |        |
| `currentStep`          | String                | No       |         |        |
| `pendingConfirmations` | PendingConfirmation[] | No       | `[]`    |        |
| `createdAt`            | Date                  | (auto)   |         |        |
| `updatedAt`            | Date                  | (auto)   |         |        |

**PendingConfirmation** (embedded):

| Field        | Type                                    | Required | Default    |
| ------------ | --------------------------------------- | -------- | ---------- |
| `id`         | String                                  | Yes      |            |
| `actionName` | String                                  | Yes      |            |
| `args`       | Mixed                                   | No       | `{}`       |
| `message`    | String                                  | Yes      |            |
| `runID`      | String                                  | No       |            |
| `status`     | Enum: `pending`, `approved`, `rejected` | No       | `pending`  |
| `feedback`   | String                                  | No       |            |
| `resolvedBy` | String                                  | No       |            |
| `resolvedAt` | Date                                    | No       |            |
| `createdAt`  | Date                                    | No       | `Date.now` |

### 4.8 Skill

**Collection:** (default Mongoose name)

| Field           | Type                                | Required | Default  | Index  |
| --------------- | ----------------------------------- | -------- | -------- | ------ |
| `name`          | String                              | Yes      |          | Unique |
| `description`   | String                              | Yes      |          |        |
| `content`       | String                              | Yes      |          |        |
| `license`       | String                              | No       |          |        |
| `compatibility` | String                              | No       |          |        |
| `allowedTools`  | String[]                            | No       | `[]`     |        |
| `metadata`      | Mixed                               | No       |          |        |
| `files`         | SkillFile[]                         | No       | `[]`     |        |
| `seedHash`      | String                              | No       |          |        |
| `origin`        | Enum: `seed`, `agent`, `user`       | No       | `user`   |        |
| `absorbedInto`  | String                              | No       |          |        |
| `status`        | Enum: `active`, `stale`, `archived` | No       | `active` |        |
| `lastUsedAt`    | Date                                | No       |          |        |
| `usageCount`    | Number                              | No       | `0`      |        |
| `curatorNotes`  | String                              | No       |          |        |
| `createdAt`     | Date                                | (auto)   |          |        |
| `updatedAt`     | Date                                | (auto)   |          |        |

**SkillFile** (embedded):

| Field     | Type   |
| --------- | ------ |
| `path`    | String |
| `content` | String |

Allowed file path prefixes: `references/`, `templates/`, `scripts/`.

### 4.9 Attachment

**Collection:** `attachments`

Attachment bytes are stored in S3-compatible object storage. MongoDB stores ownership and lookup metadata only.

| Field          | Type                  | Required | Default | Index                       |
| -------------- | --------------------- | -------- | ------- | --------------------------- |
| `attachmentID` | String                | Yes      |         | Unique                      |
| `userID`       | String                | Yes      |         | `{ userID, createdAt: -1 }` |
| `chatID`       | String                | No       |         | `{ userID, chatID }`        |
| `messageID`    | String                | No       |         | Yes                         |
| `kind`         | Enum: `image`, `file` | Yes      |         |                             |
| `mimeType`     | String                | Yes      |         |                             |
| `size`         | Number                | Yes      |         |                             |
| `sha256`       | String                | Yes      |         |                             |
| `objectKey`    | String                | Yes      |         |                             |
| `filename`     | String                | No       |         |                             |
| `deletedAt`    | Date                  | No       |         |                             |
| `createdAt`    | Date                  | (auto)   |         |                             |
| `updatedAt`    | Date                  | (auto)   |         |                             |

### 4.10 TaskPlan

**Collection:** `tasks`

| Field         | Type                                                              | Required | Default    | Index                        |
| ------------- | ----------------------------------------------------------------- | -------- | ---------- | ---------------------------- |
| `planID`      | String                                                            | Yes      |            | Unique                       |
| `parentRunID` | String                                                            | Yes      |            | `{ parentRunID, status }`    |
| `agentID`     | String                                                            | Yes      |            | `{ agentID, createdAt: -1 }` |
| `goal`        | String                                                            | Yes      |            |                              |
| `tasks`       | Task[]                                                            | No       | `[]`       |                              |
| `status`      | Enum: `planning`, `executing`, `completed`, `failed`, `cancelled` | No       | `planning` |                              |
| `revision`    | Number                                                            | No       | `0`        |                              |
| `stateJson`   | Mixed                                                             | No       | `{}`       |                              |
| `createdAt`   | Date                                                              | (auto)   |            |                              |
| `updatedAt`   | Date                                                              | (auto)   |            |                              |

**Task** (embedded):

| Field         | Type                                                                        | Required | Default   |
| ------------- | --------------------------------------------------------------------------- | -------- | --------- |
| `taskID`      | String                                                                      | Yes      |           |
| `description` | String                                                                      | Yes      |           |
| `status`      | Enum: `pending`, `in_progress`, `waiting`, `completed`, `failed`, `skipped` | No       | `pending` |
| `result`      | String                                                                      | No       |           |
| `runID`       | String                                                                      | No       |           |
| `order`       | Number                                                                      | Yes      |           |
| `waitMeta`    | Mixed                                                                       | No       |           |

### 4.10 Trigger

**Collection:** (default Mongoose name)

| Field             | Type    | Required | Default | Index  |
| ----------------- | ------- | -------- | ------- | ------ |
| `triggerID`       | String  | Yes      |         | Unique |
| `agentID`         | String  | Yes      |         | Yes    |
| `webhookPath`     | String  | Yes      |         | Unique |
| `command`         | String  | Yes      |         |        |
| `description`     | String  | No       | `''`    |        |
| `secret`          | String  | No       |         |        |
| `headers`         | Mixed   | No       |         |        |
| `enabled`         | Boolean | No       | `true`  |        |
| `executionCount`  | Number  | No       | `0`     |        |
| `lastTriggeredAt` | Date    | No       |         |        |
| `createdAt`       | Date    | (auto)   |         |        |
| `updatedAt`       | Date    | (auto)   |         |        |

### 4.11 CronJob

**Collection:** `crons`

| Field              | Type    | Required | Default | Index  |
| ------------------ | ------- | -------- | ------- | ------ |
| `jobID`            | String  | Yes      |         | Unique |
| `agentID`          | String  | Yes      |         | Yes    |
| `schedule`         | String  | Yes      |         |        |
| `command`          | String  | Yes      |         |        |
| `description`      | String  | No       | `''`    |        |
| `enabled`          | Boolean | No       | `true`  |        |
| `lastRunAt`        | Date    | No       |         |        |
| `nextRunAt`        | Date    | No       |         |        |
| `script`           | String  | No       | `''`    |        |
| `contextFromJobID` | String  | No       | `''`    |        |
| `lastRunID`        | String  | No       | `''`    |        |
| `createdAt`        | Date    | (auto)   |         |        |
| `updatedAt`        | Date    | (auto)   |         |        |

### 4.12 HeartbeatConfig

**Collection:** `heartbeats`

| Field             | Type        | Required | Default      | Index  |
| ----------------- | ----------- | -------- | ------------ | ------ |
| `agentID`         | String      | Yes      |              | Unique |
| `enabled`         | Boolean     | No       | `false`      |        |
| `intervalMinutes` | Number      | No       | `30` (min 1) |        |
| `activeHours`     | ActiveHours | No       |              |        |
| `checklist`       | String[]    | No       | `[]`         |        |
| `maxTokens`       | Number      | No       | `2048`       |        |
| `lastRunAt`       | Date        | No       |              |        |
| `nextRunAt`       | Date        | No       |              |        |
| `createdAt`       | Date        | (auto)   |              |        |
| `updatedAt`       | Date        | (auto)   |              |        |

**ActiveHours** (embedded):

| Field      | Type          | Default |
| ---------- | ------------- | ------- |
| `start`    | Number (0-23) |         |
| `end`      | Number (0-23) |         |
| `timezone` | String        | `UTC`   |

### 4.13 ScheduledExecution

**Collection:** `scheduled_executions`

Durable execution queue for cron and heartbeat firings. This collection is the horizontal-scaling coordination point: all backend instances may poll, but each scheduled occurrence is claimed through an atomic MongoDB update and lease.

| Field            | Type                                                           | Required | Default   | Index  |
| ---------------- | -------------------------------------------------------------- | -------- | --------- | ------ |
| `executionID`    | String                                                         | Yes      |           | Unique |
| `kind`           | Enum: `cron`, `heartbeat`                                      | Yes      |           | Yes    |
| `targetID`       | String                                                         | Yes      |           | Yes    |
| `agentID`        | String                                                         | Yes      |           | Yes    |
| `scheduledFor`   | Date                                                           | Yes      |           | Yes    |
| `status`         | Enum: `pending`, `running`, `completed`, `failed`, `cancelled` | Yes      | `pending` | Yes    |
| `runID`          | String                                                         | No       | `''`      |        |
| `threadID`       | String                                                         | No       | `''`      |        |
| `attempts`       | Number                                                         | No       | `0`       |        |
| `leaseOwner`     | String                                                         | No       | `''`      |        |
| `leaseExpiresAt` | Date                                                           | No       |           | Yes    |
| `startedAt`      | Date                                                           | No       |           |        |
| `completedAt`    | Date                                                           | No       |           |        |
| `error`          | String                                                         | No       | `''`      |        |
| `createdAt`      | Date                                                           | (auto)   |           |        |
| `updatedAt`      | Date                                                           | (auto)   |           |        |

Unique compound index: `{ kind: 1, targetID: 1, scheduledFor: 1 }`.

### 4.14 UsageRecord

**Collection:** (default Mongoose name)

| Field            | Type       | Required | Default | Index                       |
| ---------------- | ---------- | -------- | ------- | --------------------------- |
| `runID`          | String     | Yes      |         | Yes                         |
| `userID`         | String     | Yes      |         | `{ userID, createdAt: -1 }` |
| `provider`       | String     | Yes      |         | `{ provider, modelID }`     |
| `modelID`        | String     | Yes      |         |                             |
| `tokens`         | TokenUsage | No       |         |                             |
| `costCents`      | Number     | No       | `0`     |                             |
| `toolCallCount`  | Number     | No       | `0`     |                             |
| `durationMs`     | Number     | No       | `0`     |                             |
| `iterationCount` | Number     | No       | `0`     |                             |
| `createdAt`      | Date       | (auto)   |         |                             |
| `updatedAt`      | Date       | (auto)   |         |                             |

**TokenUsage** (embedded, `_id: false`):

| Field        | Type   | Default |
| ------------ | ------ | ------- |
| `input`      | Number | `0`     |
| `output`     | Number | `0`     |
| `thinking`   | Number | `0`     |
| `cacheRead`  | Number | `0`     |
| `cacheWrite` | Number | `0`     |

### 4.15 PluginConfigRecord

**Collection:** (default Mongoose name)

| Field         | Type    | Required | Default | Index  |
| ------------- | ------- | -------- | ------- | ------ |
| `name`        | String  | Yes      |         | Unique |
| `packageName` | String  | Yes      |         |        |
| `enabled`     | Boolean | No       | `true`  |        |
| `config`      | Mixed   | No       | `{}`    |        |
| `version`     | String  | No       |         |        |
| `loadError`   | String  | No       |         |        |
| `createdAt`   | Date    | (auto)   |         |        |
| `updatedAt`   | Date    | (auto)   |         |        |

### 4.16 McpServer

**Collection:** (default Mongoose name)

| Field       | Type                 | Required | Default | Index  |
| ----------- | -------------------- | -------- | ------- | ------ |
| `name`      | String               | Yes      |         | Unique |
| `transport` | Enum: `stdio`, `sse` | Yes      |         |        |
| `command`   | String               | No       |         |        |
| `args`      | String[]             | No       | `[]`    |        |
| `url`       | String               | No       |         |        |
| `env`       | Mixed                | No       | `{}`    |        |
| `enabled`   | Boolean              | No       | `true`  |        |
| `createdAt` | Date                 | (auto)   |         |        |
| `updatedAt` | Date                 | (auto)   |         |        |

### 4.17 Commitment

**Collection:** `commitments`

| Field             | Type                                                 | Required | Default   | Index  |
| ----------------- | ---------------------------------------------------- | -------- | --------- | ------ |
| `commitmentID`    | String                                               | Yes      |           | Unique |
| `agentID`         | String                                               | Yes      |           | Yes    |
| `userID`          | String                                               | Yes      |           | Yes    |
| `description`     | String                                               | Yes      |           |        |
| `status`          | Enum: `pending`, `completed`, `expired`, `cancelled` | No       | `pending` |        |
| `dueAt`           | Date                                                 | No       |           |        |
| `reminderAt`      | Date                                                 | No       |           |        |
| `sourceRunID`     | String                                               | No       | `''`      |        |
| `sourceThreadID`  | String                                               | No       | `''`      |        |
| `completionRunID` | String                                               | No       | `''`      |        |
| `tags`            | String[]                                             | No       | `[]`      |        |
| `metadata`        | Mixed                                                | No       | `{}`      |        |
| `createdAt`       | Date                                                 | (auto)   |           |        |
| `updatedAt`       | Date                                                 | (auto)   |           |        |

### 4.18 ContextState

**Collection:** `context_states`

Per-thread compaction summary and policy state. Owned by the context module (§9). Survives run boundaries so iterative summary updates can resume across runs. One document per thread.

| Field                  | Type   | Required | Default | Index  |
| ---------------------- | ------ | -------- | ------- | ------ |
| `threadID`             | String | Yes      |         | Unique |
| `summaryText`          | String | No       | `''`    |        |
| `summaryUpdatedAt`     | Date   | No       |         |        |
| `summaryGenerations`   | Number | No       | `0`     |        |
| `lastDecision`         | String | No       | `''`    |        |
| `lastSummaryCostCents` | Number | No       | `0`     |        |
| `lastSummaryModel`     | String | No       | `''`    |        |
| `thrashCounter`        | Number | No       | `0`     |        |
| `lastSavingsRatio`     | Number | No       | `0`     |        |
| `createdAt`            | Date   | (auto)   |         |        |
| `updatedAt`            | Date   | (auto)   |         |        |

`thrashCounter` increments when a Tier 1 summarization saves <10% of input tokens; it resets to 0 on an effective compression. `summaryGenerations` increments on every persisted summary write and is the input to the `CONTEXT_SUMMARY_MAX_GENERATIONS` stale-summary guard. `lastDecision` records the most recent `ContextDecision` for operator visibility.

When a thread is deleted, the corresponding `context_states` document is removed in the same call path.

### 4.19 ModelCatalogEntry

**Collection:** `models`

Authoritative allowlist of models the system will accept. Both `POST /agent/chat` and `PATCH /chats/:id` validate `body.model` / `dto.model` against this collection (`ModelRouter.isValidModel` → `ModelCatalogService.isValidActiveModel`). The collection is seeded from a built-in default on first boot (see §7); operators may CRUD it via `/models` thereafter. `ModelRouter` still owns runtime concerns (provider keys, retry, fallback) — the catalog only governs *which* `provider/modelID` specs are admissible.

| Field                       | Type   | Required | Default | Index  |
| --------------------------- | ------ | -------- | ------- | ------ |
| `spec`                      | String | Yes      |         | Unique |
| `provider`                  | String | Yes      |         | Yes    |
| `modelID`                   | String | Yes      |         |        |
| `displayName`               | String | Yes      |         |        |
| `enabled`                   | Boolean| No       | `true`  |        |
| `contextWindow`             | Number | No       |         |        |
| `inputCostCentsPerMTok`     | Number | No       |         |        |
| `outputCostCentsPerMTok`    | Number | No       |         |        |
| `cacheReadCostCentsPerMTok` | Number | No       |         |        |
| `cacheWriteCostCentsPerMTok`| Number | No       |         |        |
| `metadata`                  | Mixed  | No       | `{}`    |        |
| `createdAt`                 | Date   | (auto)   |         |        |
| `updatedAt`                 | Date   | (auto)   |         |        |

`spec` is the canonical `provider/modelID` join key used by `Chat.model`, `AgentConfig.modelOptions.preferredModel`, and request body fields. Pricing fields express **cents per million tokens** (integer); the cost calculator divides by 1,000,000 when applying to token counts.

---

## 5. API Surface

All endpoints are prefixed with `/api/v1` unless noted. Authentication is required by default (SessionAuthGuard). Public endpoints are marked.

### 5.1 Health

| Method | Path      | Auth   | Description                |
| ------ | --------- | ------ | -------------------------- |
| GET    | `/health` | Public | Returns `{ status: 'ok' }` |

### 5.2 Agent (Core)

| Method | Path                                       | Auth | Body / Params                              | Response                      |
| ------ | ------------------------------------------ | ---- | ------------------------------------------ | ----------------------------- |
| POST   | `/agent/chat`                              | Yes  | `ChatRequestBody`                          | `{ runID, threadID, chatID }` |
| SSE    | `/agent/stream/:runID`                     | Yes  | Query/Header: `last-event-id`              | `Observable<MessageEvent>`    |
| GET    | `/agent/active-run/:chatID`                | Yes  |                                            | `{ runID, threadID }`         |
| POST   | `/agent/cancel/:runID`                     | Yes  |                                            | `{ cancelled: boolean }`      |
| POST   | `/agent/confirm/:threadID/:confirmationID` | Yes  | `{ approved: boolean, feedback?: string }` | `{ resolved: boolean }`       |
| GET    | `/agent/state/:threadID`                   | Yes  |                                            | `StateSnapshot`               |
| POST   | `/agent/attachments`                       | Yes  | Multipart `file` field                     | `Attachment`                  |
| GET    | `/agent/attachments/:id/content`           | Yes  |                                            | Raw attachment bytes          |

**ChatRequestBody:**

```typescript
{
  message: string;
  attachmentIDs?: string[];
  chatID?: string;
  threadID?: string;
  agentID?: string;
  model?: string;
  config?: {
    maxSteps?: number;      // Default: 15
    maxIterations?: number; // Default: 5
  };
}
```

`message` may be empty only when `attachmentIDs` is non-empty. `attachmentIDs` must reference attachments owned by the authenticated user. The chat message stores attachment summaries separately from text, and the orchestrator resolves those attachments immediately before each model call into AI SDK image/file content parts.

**Attachment:**

```typescript
{
  id: string;
  kind: 'image' | 'file';
  mimeType: string;
  size: number;
  filename?: string;
  createdAt: string;
}
```

### 5.3 Chats

| Method | Path         | Auth | Body / Params   | Response                   |
| ------ | ------------ | ---- | --------------- | -------------------------- |
| POST   | `/chats`     | Yes  | `CreateChatDto` | Chat                       |
| GET    | `/chats`     | Yes  |                 | Chat[] (excludes messages) |
| GET    | `/chats/:id` | Yes  |                 | Chat                       |
| PATCH  | `/chats/:id` | Yes  | `UpdateChatDto` | Chat                       |
| DELETE | `/chats/:id` | Yes  |                 | void                       |

Ownership enforced: users can only access their own chats.

**UpdateChatDto** (partial — every field optional):

```typescript
{
  messages?: MessageDto[];   // full replacement of the messages array
  agentID?: string;          // sticky picker selection; validated against §4.18
  model?: string;            // sticky picker selection; validated against §4.19
}
```

`agentID` is validated through `AgentsService.isValidActiveAgent` (must exist + `enabled === true`). `model` is validated through `ModelRouter.isValidModel` → `ModelCatalogService.isValidActiveModel`. Either invalid value returns 400 BadRequest.

### 5.4 Agents

| Method | Path                          | Auth | Body / Params      | Response            |
| ------ | ----------------------------- | ---- | ------------------ | ------------------- |
| POST   | `/agents`                     | Yes  | `CreateAgentDto`   | AgentConfig         |
| GET    | `/agents`                     | Yes  |                    | AgentConfig[]       |
| GET    | `/agents/:agentID`            | Yes  |                    | AgentConfig         |
| PUT    | `/agents/:agentID`            | Yes  | `UpdateAgentDto`   | AgentConfig         |
| DELETE | `/agents/:agentID`            | Yes  |                    | `{ deleted: true }` |
| POST   | `/agents/bindings`            | Yes  | `CreateBindingDto` | AgentBinding        |
| GET    | `/agents/bindings/list`       | Yes  | Query: `agentID?`  | AgentBinding[]      |
| DELETE | `/agents/bindings/:bindingID` | Yes  |                    | `{ deleted: true }` |

### 5.5 Skills

| Method | Path            | Auth | Body / Params    | Response            |
| ------ | --------------- | ---- | ---------------- | ------------------- |
| POST   | `/skills/sync`  | Yes  |                  | SyncResult          |
| POST   | `/skills`       | Yes  | `CreateSkillDto` | Skill               |
| GET    | `/skills`       | Yes  |                  | Skill[]             |
| GET    | `/skills/:name` | Yes  |                  | Skill               |
| PUT    | `/skills/:name` | Yes  | `UpdateSkillDto` | Skill               |
| DELETE | `/skills/:name` | Yes  |                  | `{ deleted: true }` |

### 5.6 Prompts

| Method | Path             | Auth | Body / Params                                    | Response            |
| ------ | ---------------- | ---- | ------------------------------------------------ | ------------------- |
| POST   | `/prompts/sync`  | Yes  |                                                  | SyncResult          |
| GET    | `/prompts`       | Yes  |                                                  | PromptSummary[]     |
| GET    | `/prompts/:slug` | Yes  |                                                  | PromptResponse      |
| PUT    | `/prompts/:slug` | Yes  | `{ content, extends?, description?, metadata? }` | PromptResponse      |
| DELETE | `/prompts/:slug` | Yes  |                                                  | `{ deleted: true }` |

**PromptSummary:** `{ slug, extends, seedHash, description, metadata, createdAt, updatedAt }` (excludes `content`).
**PromptResponse:** PromptSummary + `{ content }`.

### 5.7 Heartbeats

| Method | Path                   | Auth | Body / Params        | Response            |
| ------ | ---------------------- | ---- | -------------------- | ------------------- |
| POST   | `/heartbeats`          | Yes  | `CreateHeartbeatDto` | HeartbeatConfig     |
| GET    | `/heartbeats`          | Yes  |                      | HeartbeatConfig[]   |
| GET    | `/heartbeats/:agentID` | Yes  |                      | HeartbeatConfig     |
| PUT    | `/heartbeats/:agentID` | Yes  | `UpdateHeartbeatDto` | HeartbeatConfig     |
| DELETE | `/heartbeats/:agentID` | Yes  |                      | `{ deleted: true }` |

### 5.8 Triggers (Webhooks)

| Method | Path              | Auth                                       | Body / Params                           | Response                     |
| ------ | ----------------- | ------------------------------------------ | --------------------------------------- | ---------------------------- |
| POST   | `/webhooks/:path` | `@WebhookProtected()` + `WebhookAuthGuard` | JSON payload or `text/*` string payload | `{ runID, triggerID }` (202) |

Webhook requests must include `x-webhook-api-key: <WEBHOOK_API_KEY>` or `Authorization: Bearer <WEBHOOK_API_KEY>`. Payloads may be JSON or `text/*`. If the trigger also has a configured secret, `x-webhook-secret` is additionally required.

### 5.9 Plugins

| Method | Path                    | Auth | Body / Params                              | Response              |
| ------ | ----------------------- | ---- | ------------------------------------------ | --------------------- |
| GET    | `/plugins`              | Yes  |                                            | `{ configs, loaded }` |
| POST   | `/plugins`              | Yes  | `{ name, packageName, config?, enabled? }` | `{ success: true }`   |
| DELETE | `/plugins/:name`        | Yes  |                                            | `{ success: true }`   |
| PATCH  | `/plugins/:name/toggle` | Yes  | `{ enabled: boolean }`                     | `{ success: true }`   |

### 5.10 Insights

| Method | Path                   | Auth | Body / Params                         | Response                 |
| ------ | ---------------------- | ---- | ------------------------------------- | ------------------------ |
| GET    | `/insights/usage`      | Yes  | Query: `since?`, `until?` (ISO dates) | `AggregateResult`        |
| GET    | `/insights/run/:runID` | Yes  |                                       | UsageRecord[]            |
| GET    | `/insights/tools`      | Yes  | Query: `limit?` (default 10)          | `Array<{ tool, count }>` |

### 5.11 Crons

| Method | Path            | Auth | Body / Params                                                                        | Response            |
| ------ | --------------- | ---- | ------------------------------------------------------------------------------------ | ------------------- |
| POST   | `/crons`        | Yes  | `{ agentID, schedule, command, description?, enabled?, script?, contextFromJobID? }` | CronJob             |
| GET    | `/crons`        | Yes  | Query: `agentID?`                                                                    | CronJob[]           |
| GET    | `/crons/:jobID` | Yes  |                                                                                      | CronJob             |
| PUT    | `/crons/:jobID` | Yes  | `{ schedule?, command?, description?, enabled?, script?, contextFromJobID? }`        | CronJob             |
| DELETE | `/crons/:jobID` | Yes  |                                                                                      | `{ deleted: true }` |

`CronController` is registered in `CronModule` and reaches `AppModule` via `AgentModule → CronModule`. The `:jobID` is a UUID minted by the service on create — not by the client. PUT recomputes `nextRunAt` whenever `schedule` is provided. The list endpoint scopes by `agentID` when the query param is given.

### 5.12 Memories

| Method | Path            | Auth | Body / Params | Response            |
| ------ | --------------- | ---- | ------------- | ------------------- |
| GET    | `/memories`     | Yes  |               | MemoryEntry[]       |
| DELETE | `/memories/:id` | Yes  |               | `{ deleted: true }` |

Scoped to the authenticated user via `@CurrentUser()`. `MemoryController` is registered in `MemoryModule` and reaches `AppModule` via `AgentModule → OrchestrationModule → MemoryModule`. See §13 for `MemoryEntry` shape and storage details.

### 5.13 Models

| Method | Path                        | Auth | Body / Params                    | Response            |
| ------ | --------------------------- | ---- | -------------------------------- | ------------------- |
| POST   | `/models`                   | Yes  | `CreateModelDto`                 | ModelCatalogEntry   |
| GET    | `/models`                   | Yes  | Query: `enabled=true` (optional) | ModelCatalogEntry[] |
| GET    | `/models/:provider/:modelID`| Yes  |                                  | ModelCatalogEntry   |
| PATCH  | `/models/:provider/:modelID`| Yes  | `UpdateModelDto`                 | ModelCatalogEntry   |
| DELETE | `/models/:provider/:modelID`| Yes  |                                  | `{ deleted: true }` |

The two path segments are concatenated to the canonical `spec` (`provider/modelID`) used by the service. `POST` requires `spec === provider + '/' + modelID`. See §4.19 for the schema and §7 for the seeded defaults.

---

## 6. Orchestration Engine

The orchestrator is the core execution loop that processes user messages through LLM inference with tool use.

### Execution Flow

```
POST /agent/chat
  |
  v
[Resolve Agent] -- body.agentID > chat.agentID > AgentRouterService.resolve(context)
  |                 Router priority: user binding > channel binding > default binding
  v
[Create/Load Chat] -- ChatsService
  |
  v
[Start Async] -- Returns { runID, threadID, chatID } immediately
  |
  v
[OrchestratorService.executeGoal()]
  |
  +-- 1. Create AbortController, subscribe to cancel:{runID} pub/sub
  +-- 2. Get/create thread, start run (status: pending -> running)
  +-- 3. Initialize SSE stream (run:{runID}:stream)
  +-- 4. Load AgentConfig
  +-- 5. Resolve model (provider + model ID)
  +-- 6. Capture frozen memory context (MemoryService.getContextForQuery)
  +-- 7. Build system prompt (PromptBuilderService)
  +-- 8. Get filtered tool set (apply ToolPolicy)
  +-- 9. Load conversation history or create new message
  |
  +-- 10. MAIN LOOP (up to maxIterations, default 5):
  |     |
  |     +-- Add "Continue." if last message isn't from user
  |     +-- Compress context if needed (ContextCompressorService)
  |     +-- Stream from model (ModelRouterService.stream)
  |     +-- Process stream events:
  |     |     - reasoning-start/delta/end -> emit thinking events
  |     |     - text-delta -> emit text events
  |     |     - tool-call -> record, emit started/executing, execute tool
  |     |     - tool-result -> record result, emit result event
  |     |     - tool-error -> record error, emit error event
  |     +-- Check loop detection (circuit breaker)
  |     +-- If no tool calls in response -> model is done, exit loop
  |
  +-- 11. Complete run:
        +-- Mark run completed in StateService
        +-- Record usage metrics (InsightsService)
        +-- Append assistant message to chat
        +-- Emit run.completed event
        +-- Extract and store memory (unless heartbeat run)
        +-- Trigger skill review if thresholds met
```

### AgentGoal

```typescript
interface AgentGoal {
  threadID: string;
  runID: string;
  userID: string;
  userName?: string;
  chatID?: string;
  agentID: string;
  userMessage: string;
  conversationHistory: ModelMessage[];
  modelOptions?: ModelRequestOptions;
  isHeartbeat?: boolean;
  delegationDepth?: number;
}
```

### OrchestratorConfig

```typescript
interface OrchestratorConfig {
  maxSteps: number; // Max tool calls per stream call (default: 15)
  maxIterations: number; // Max outer loop iterations (default: 5)
  wallClockTimeoutMs: number; // Wall-clock timeout in ms, 0 = no limit (default: 0)
}
```

A shared `AUTONOMOUS_RUN_CONFIG` constant provides the standard config for autonomous runs (cron, heartbeat, webhook): `{ maxSteps: 10, maxIterations: 2, wallClockTimeoutMs: 180000 }`. The timeout can be overridden via `AUTONOMOUS_WALL_CLOCK_TIMEOUT_MS`.

### Context Length Recovery

If the model returns a context length error during streaming, the orchestrator forces compression on the next iteration (bypassing the 75% threshold) and retries. This only works if there are remaining iterations (`iterationCount < maxIterations`). Otherwise, the error propagates and fails the run.

### Cancellation

- Cancellation is coordinated via Redis pub/sub on channel `cancel:{runID}`.
- `POST /agent/cancel/:runID` publishes to this channel.
- The orchestrator subscribes on run start and aborts via `AbortController`.
- Throws `AbortedError` which marks the run as `cancelled` and emits a terminal `run.cancelled` event.

### Prompt Building

`PromptBuilderService.build(userID, query, agentConfig, frozenMemoryContext?, userName?)` assembles the system prompt in this order:

Default slug load order: `system`, `soul`, `identity`, `user`, `tools`, `heartbeat`.

If the agent has a custom `promptSlug`, it is prepended to the load order and removed from its default position (if it matches one of the standard slugs). This allows agents to override the system prompt with their own. 7. **Frozen memory context** (user memories relevant to the query) 8. **Knowledge context** (from KnowledgeService, including MemoryKnowledgeProvider) 9. **Relevant skills** (matched by query, formatted for prompt)

Missing prompt slugs are silently skipped. Throws if zero prompts resolve.

### Subagent Detection

Tool calls to `sessions_spawn` or `agent_message` are detected as subagent operations. The orchestrator emits `subagent.spawned`, `subagent.completed`, or `subagent.failed` events based on the tool result.

### Skill Review Trigger

After run completion, the orchestrator increments per-thread turn and tool-call counters stored in `AgentState.custom`. When either counter meets or exceeds its threshold, both counters reset to zero and `SkillReviewService.review()` is triggered asynchronously.

| Counter    | State Key              | Threshold Env Var             | Default |
| ---------- | ---------------------- | ----------------------------- | ------- |
| Turns      | `turnsSinceReview`     | `SKILL_REVIEW_TURN_THRESHOLD` | 3       |
| Tool calls | `toolCallsSinceReview` | `SKILL_REVIEW_TOOL_THRESHOLD` | 5       |

---

## 7. Model Router

The `ModelRouterService` manages multiple LLM providers with automatic failover, credential pooling, and prompt caching. Which `provider/modelID` specs are **admissible** is owned by the model catalog (§4.19); the router owns *how* to call admissible specs.

### Admissibility (Model Catalog)

`ModelRouterService.isValidModel(spec)` delegates to `ModelCatalogService.isValidActiveModel(spec)`. Used by `POST /agent/chat` and `PATCH /chats/:id` to reject unknown or disabled specs with 400 before any run starts.

The `models` collection is seeded on first boot by `ModelCatalogBootstrapService` from a built-in default list. The bootstrap is one-shot — it only seeds when the collection is empty, so operator edits persist across deploys. Pricing fields on each catalog entry are the source the cost calculator in §22 reads.

### Providers

A `ProviderEntry` in `ModelRouterService` stores only the provider id, priority, and a factory closure that constructs the AI SDK `LanguageModel` for a given model id. The list of admissible models is **not** stored on the provider entry — there is no `allowedModels` Set and no `defaultModel` string in code. The catalog is the only allowlist:

| Provider  | Priority | Thinking                                                   |
| --------- | -------- | ---------------------------------------------------------- |
| Anthropic | 1        | Adaptive (opus-4/sonnet-4-6/sonnet-4-5), Budgeted (others) |
| OpenAI    | 2        | No                                                         |
| Google    | 3        | No                                                         |
| vLLM      | 4        | No                                                         |

When a caller specifies `preferredProvider` without `preferredModel`, the router calls `ModelCatalogService.findEnabled()` and picks the first catalog row matching that provider. Same for the "try every provider" last-resort pass in resolution. Adding/removing a model is a catalog operation (`POST/DELETE /api/v1/models`); it does not require a code change or redeploy.

All model references in `PRIMARY_MODEL`, `FALLBACK_MODELS`, and `preferredModel` use `provider/model` format (e.g., `anthropic/claude-sonnet-4-6`). The router parses this to find the correct provider entry; the modelID portion is passed straight to the provider SDK without a parallel hardcoded check.

### Model Resolution Order

1. Preferred model (if specified and provider not excluded)
2. Preferred provider (if specified and not excluded)
3. Primary model (from `PRIMARY_MODEL` env var)
4. Fallback models (from `FALLBACK_MODELS` env var, in order)
5. First available provider (by priority)

### Retry & Failover

**`generate()` method:**

- **Per provider:** up to 3 attempts with exponential backoff (capped at 30s) plus jitter
- **Across providers:** an outer loop walks the resolved provider list (primary + `FALLBACK_MODELS`), so with N providers the worst-case total is 3 × N attempts before exhaustion
- On context length errors: thrown immediately (triggers compression)
- On retryable non-rotate errors (500, 504, request timeout, connection reset): retry with backoff on the same provider
- On rotate-required errors (rate limit, quota, invalid auth, model not found, service unavailable): cooldown the provider key, exclude provider, advance to next
- Throws after all providers exhausted

**`stream()` method:**

- No retry (streaming cannot be restarted)
- Same provider resolution as `generate()`

### Error Classification

| Category            | HTTP Status / Pattern   | Retryable | Rotate Provider | Compress |
| ------------------- | ----------------------- | --------- | --------------- | -------- |
| Rate Limit          | 429                     | Yes       | Yes             | No       |
| Quota Exhausted     | "quota" in message      | No        | Yes             | No       |
| Server Error        | 500                     | Yes       | No              | No       |
| Service Unavailable | 502, 503                | Yes       | Yes             | No       |
| Gateway Timeout     | 504                     | Yes       | No              | No       |
| Request Timeout     | timeout/ETIMEDOUT       | Yes       | No              | No       |
| Connection Reset    | ECONNRESET/socket hang  | Yes       | No              | No       |
| Connection Refused  | ECONNREFUSED            | No        | No              | No       |
| DNS Failure         | ENOTFOUND/getaddrinfo   | No        | No              | No       |
| TLS Error           | TLS/SSL/certificate     | No        | No              | No       |
| Content Filter      | safety/moderation       | No        | No              | No       |
| Context Length      | 400 + "context" message | No        | No              | Yes      |
| Invalid Auth        | 401, 403                | No        | Yes             | No       |
| Model Not Found     | 404                     | No        | Yes             | No       |
| Aborted             | abort message           | No        | No              | No       |

### Credential Pool

Each provider can have multiple API keys configured via comma-separated environment variables.

**Rotation Strategies:**

- `round_robin` (default): Cycles through available keys sequentially
- `least_used`: Picks the key with the lowest usage count
- `random`: Random selection

**Cooldown:** When a key triggers a rotate-required error, it enters a 60-second cooldown. If all keys are on cooldown, the soonest-available key is used.

### Prompt Caching

| Provider  | Strategy  | Behavior                                                                                                  |
| --------- | --------- | --------------------------------------------------------------------------------------------------------- |
| Anthropic | Explicit  | System prompt gets `cacheControl: { type: 'ephemeral' }`. Last 3 non-tool messages get cache breakpoints. |
| OpenAI    | Automatic | No modifications; OpenAI caches stable prefixes automatically.                                            |
| Google    | Automatic | No modifications.                                                                                         |
| vLLM      | None      | No caching.                                                                                               |

---

## 8. Streaming & Events

### Event Transport

Events flow through a Redis Stream (`run:{runID}:stream`) and are delivered to clients via Server-Sent Events (SSE).

### SSE Endpoint

`GET /agent/stream/:runID`

- Supports reconnection via `last-event-id` header or query param
- On connect: replays all events from stream, emits `replay.done` boundary, then tails with `XREAD BLOCK`
- Completes on `run.completed`, `run.failed`, or `run.cancelled` events
- Stream TTL: 1800s during execution, reduced to 300s after completion

### Response Headers

The SSE handler is implemented as a raw `@Get` with manual writes to `res` (not NestJS's `@Sse` decorator) so that SSE comment lines can be emitted for keep-alive and so that buffering can be explicitly disabled. The response sets:

| Header              | Value                    | Reason                                                            |
| ------------------- | ------------------------ | ----------------------------------------------------------------- |
| `Content-Type`      | `text/event-stream`      | SSE framing                                                       |
| `Cache-Control`     | `no-cache, no-transform` | Prevents intermediaries from rewriting the stream                 |
| `Connection`        | `keep-alive`             | Long-lived socket                                                 |
| `X-Accel-Buffering` | `no`                     | Disables response buffering in nginx-family proxies (k3s ingress) |

Express response compression (if globally enabled) MUST exclude the stream route. The bootstrap intentionally does not register `compression()`; any future addition must filter on `req.path`.

### Heartbeat Protocol

While the run is live and the Redis stream produces no new entries (typical during long-running tool calls), the server emits an SSE comment line `: ping <epoch-ms>\n\n` every **15 seconds**. Comment lines are ignored by the browser's `EventSource.onmessage` but force a socket flush, defeating idle-read timeouts at every layer (Node socket, k3s ingress, browser).

Implementation: a `setInterval(15_000)` writes the comment line; the interval is cleared when the observable unsubscribes (client disconnect) or a terminal event is emitted. The `XREAD BLOCK` interval is set to 10000ms so the heartbeat cadence remains stable regardless of stream activity.

### Reconnection & Resume

Clients reconnect by reopening the SSE endpoint with the last `streamID` they observed, supplied as either:

- `Last-Event-ID` header (auto-sent by `EventSource` after a native reconnect), or
- `?last-event-id=<streamID>` query parameter (used by explicit client-driven retry, since `EventSource` does not allow setting custom headers).

The server resolves the cursor (query param wins if both present), replays all entries strictly after that ID via `XRANGE (cursor +`, emits `replay.done`, then tails. A cursor of `'0'` means full replay. If the cursor is past the end of the stream, replay is empty and the tail loop takes over immediately.

### Event Types

```typescript
type AgentEventType =
  | 'run.started' // { provider, modelID, chatID? }
  | 'run.completed' // { response }
  | 'run.failed' // { error }
  | 'run.cancelled' // { reason }
  | 'thinking.delta' // { content }
  | 'thinking.done' // { content }
  | 'text.delta' // { content }
  | 'text.done' // { content }
  | 'tool_call.started' // { toolCallID, toolName, args }
  | 'tool_call.executing' // { toolCallID, toolName }
  | 'tool_call.result' // { toolCallID, toolName, result, success }
  | 'tool_call.error' // { toolCallID, toolName, error }
  | 'subagent.spawned' // { toolCallID, subagentRunID, subagentThreadID, agentID, goal }
  | 'subagent.completed' // { toolCallID, subagentRunID, status, response? }
  | 'subagent.failed' // { toolCallID, subagentRunID, error }
  | 'confirmation.required' // { confirmationID, actionName, args, message }
  | 'confirmation.resolved' // { confirmationID, approved }
  | 'context.compression.started' // { provider, modelID, beforeTokens }
  | 'context.compression.completed' // { decision, beforeTokens, afterTokens, pruned, summary?, auxModelFailure? }
  | 'context.compression.skipped' // { reason: 'thrash' | 'cooldown', detail }
  | 'context.reference.expanded' // { kind, target, injectedTokens }
  | 'replay.done' // (boundary marker for replay)
  | 'error'; // { error, recoverable }
```

### AgentEvent Envelope

```typescript
interface AgentEvent {
  type: AgentEventType;
  runID: string;
  threadID: string;
  timestamp: number;
  data: unknown; // Type-specific payload (see above)
  streamID?: string; // Redis stream entry ID
}
```

### Active Run Tracking

When a run starts, a Redis key `chat:{chatID}:activeRun` stores `{ runID, threadID }` as JSON. This enables `GET /agent/active-run/:chatID` to find the current run for SSE reconnection.

---

## 9. Context Management

The context management subsystem shapes the prompt window for every model call: it keeps tokens within budget, expands user references before the run starts, persists compaction summaries across runs, redacts secrets, and surfaces compression state to clients.

### 9.1 Module Structure

`src/agent/context/`:

| Path                                                              | Purpose                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `context-orchestration.service.ts`                                | Public entry point. Coordinates preprocessing → engine → persistence → events. |
| `interfaces.ts`                                                   | `ContextPrepareInput`, `ContextPrepareResult`, `ContextDecision` enum.        |
| `engine/context-engine.interface.ts`                              | `IContextEngine` boundary. One method: `prepare`.                              |
| `engine/compacting-engine.service.ts`                             | Default `IContextEngine` — Tier 0 lossless pruning + Tier 1 summarization.     |
| `engine/summarizer.service.ts`                                    | Owns the LLM summarization call, prompt assembly, iterative merge.            |
| `tokens/token-counter.service.ts`                                 | Model-aware token counting; image cost included.                              |
| `tokens/model-context-window.service.ts`                          | Per-model context window resolution; falls back to provider default.          |
| `pruning/tool-result-deduplicator.service.ts`                     | sha256 newest-wins dedup of identical tool outputs.                           |
| `pruning/tool-arg-truncator.service.ts`                           | JSON-safe shrinking of large string leaves in `tool-call` args.               |
| `pruning/image-pruner.service.ts`                                 | Strips image parts older than the most recent image-bearing user message.     |
| `pruning/tool-result-renderer.service.ts`                         | Maps `(toolName, args, result) → short summary` via per-tool renderers.       |
| `policy/compression-policy.service.ts`                            | Anti-thrash skip, cooldown after failure, force bypass.                       |
| `redaction/secret-redactor.service.ts`                            | Pattern-based secret redaction; runs pre-summarize and post-summarize.        |
| `persistence/context-state.schema.ts`                             | `ContextState` Mongoose schema (collection: `context_states`).                |
| `persistence/summary-store.service.ts`                            | Load/persist per-thread compaction summary.                                   |
| `preprocessing/context-reference-preprocessor.service.ts`         | Expands `@file:`, `@diff`, `@staged`, `@url:` references in user messages.   |
| `preprocessing/reference-resolvers/{file,diff,staged,url}.resolver.ts` | One resolver per reference kind.                                         |
| `events/context-event-emitter.service.ts`                         | Emits `context.*` SSE events through `RunStreamService`.                      |

### 9.2 Public API

```typescript
interface ContextPrepareInput {
  threadID: string;
  runID: string;
  agentID: string;
  userID: string;
  messages: ModelMessage[];
  provider: string;
  modelID: string;
  systemPrompt?: string;
  force?: boolean;
}

type ContextDecision =
  | 'noop'             // under threshold, no Tier 1 needed
  | 'pruned'           // Tier 0 lossless pruning was sufficient
  | 'summarized'       // Tier 1 summarization was performed
  | 'skipped_thrash'   // last 2 compressions saved <10% each
  | 'cooldown_active'  // summarizer is in failure cooldown
  | 'force_failed';    // forced compression but summarization failed irrecoverably

interface ContextPrepareStats {
  beforeTokens: number;
  afterTokens: number;
  pruned: {
    duplicates: number;
    images: number;
    toolArgs: number;
    toolResults: number;
  };
  summary?: {
    generatedTokens: number;
    costCents: number;
    model: string;
    iterative: boolean;
  };
  auxModelFailure?: { model: string; error: string };
}

interface ContextPrepareResult {
  messages: ModelMessage[];
  decision: ContextDecision;
  stats: ContextPrepareStats;
  summaryUpdated: boolean;
}

ContextOrchestrationService.prepare(
  input: ContextPrepareInput,
): Promise<ContextPrepareResult>;
```

The orchestrator calls `prepare()` once per iteration of the outer loop before each model stream call. The result drives a single `context.compression.*` SSE event and an optional persistence write.

### 9.3 Pipeline Stages

1. **Hydrate** — if a prior `ContextState` exists for the thread, the persisted summary is read and used to seed iterative merge.
2. **Tier 0 — Lossless pruning** (always runs): tool-result deduplication, JSON-safe argument truncation, image pruning.
3. **Threshold check** — compare token count (model-aware, with image cost) against `model_context_window × 0.75`. If below and not forced, return `noop`.
4. **Policy check** — `CompressionPolicy.shouldRun()` returns `false` if anti-thrash kicked in or summarizer cooldown is active. Force bypasses both. Returns `skipped_thrash` or `cooldown_active` accordingly.
5. **Tier 1 — Summarization** — LLM-driven structured summary of the middle window. Head, tail, and (optionally) the prior summary are preserved verbatim.
6. **Persist** — on `summarized`, the new summary is written to `ContextState`.
7. **Emit** — `context.compression.completed` SSE event with the full result.

### 9.4 Token Counting

`TokenCounter.count(content, modelID, provider)` returns the token cost of a content string or multimodal parts list. Image parts contribute a flat **1600 tokens** each — a provider-agnostic ceiling that keeps multimodal budgeting honest. String content uses `js-tiktoken` with provider-specific encoder. Per-message overhead is 4 tokens.

`ModelContextWindow.get(modelID, provider)` resolves the context window in this order:

1. Per-model override from `MODEL_CONTEXT_WINDOWS` (JSON map env var, e.g. `{"Qwen3.6-27B-FP8": 131072}`).
2. Provider default env var (`ANTHROPIC_CONTEXT_WINDOW`, etc.).
3. Built-in defaults (Anthropic 200K, OpenAI 128K, Google 1M, vLLM 131K).

### 9.5 Lossless Pruning

Tier 0 always runs before the threshold check. On every call, any duplicates are collapsed and old images are removed regardless of whether full compression fires.

| Stage          | Behavior                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedup          | Walks tool messages newest-first. Identical content (sha256 of ≥200-char string outputs) collapses to `[Duplicate tool output — same content as a more recent call]` on the older copy. |
| Arg truncation | Parses each `tool-call` arg JSON, shrinks string leaves >500 chars to first-200 chars + `...[truncated]`, re-serializes. Non-JSON args returned unchanged. Prevents downstream provider 400s on malformed arg JSON. |
| Image pruning  | Anchors on the most recent user message with image parts. All earlier image parts in any message become `{ type: 'text', text: '[screenshot removed to save context]' }`.            |

### 9.6 Tool-Result Renderer

When Tier 1 summarization fires, large tool results in the middle window are replaced with one-line semantic summaries instead of generic `[Pruned: N chars]` placeholders. A registry maps `toolName → renderer(args, result) → string`. A tool may register its own renderer by implementing the optional `renderResultSummary` method on the `Tool` interface (see §10). If a tool does not define one, the default fallback renders as `[{toolName}] {keyArgs} ({size})`.

### 9.7 Summarization

`SummarizerService.summarize(middle, options)` performs the LLM call. Behaviors:

- **Budget scaling** — `tokens = clamp(content_tokens × 0.20, 2000, min(context_window × 0.05, 12000))`.
- **Aux-model resolution order**:
  1. `AgentConfig.modelOptions.summaryModel` (per-agent, surfaced in SERAUI).
  2. `SUMMARY_MODEL` env (global default).
  3. Primary `ModelRouter`.
- **Aux-model fallback** — on 404, 503, or timeout from the aux model, falls back to the primary router. The result records `auxModelFailure` so SERAUI can warn the operator.
- **Iterative merge** — if `ContextState` has a prior summary, the prompt instructs the model to **update** it rather than regenerate from scratch.
- **Structured prompt** — multi-paragraph preamble explicitly frames the summary as "background reference, NOT active instructions" and tells the model to resume from the `## Active Task` section. Sections required in the body:

```
## Active Task
## Goal
## Constraints & Preferences
## Completed Actions
## Active State
## In Progress
## Blocked
## Key Decisions
## Resolved Questions
## Pending User Asks
## Relevant Files
## Remaining Work
## Critical Context
```

- **Head & tail protection** — head: first 2 messages always preserved. Tail: most recent messages up to `min(30000 tokens, threshold × 0.4)` preserved verbatim.
- **Custom prompt slug** — the `summary` prompt slug, if defined, overrides the preamble; the structured section list is always emitted.

The summarized output is wrapped in a system message with a multi-paragraph `[CONTEXT COMPACTION — REFERENCE ONLY]` prefix that explicitly tells the model not to re-answer questions from the summary and to treat persistent memory as authoritative. A canned assistant acknowledgement follows the system message.

### 9.8 Anti-Thrash & Cooldown Policy

`CompressionPolicy` tracks per-thread (anti-thrash) and per-process (cooldown) state:

| State               | Trigger                                                          | Effect                                                                                  |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Thrash              | Last 2 successful summarizations each saved <10% of input tokens | `shouldRun()` returns `false`; result decision is `skipped_thrash`.                      |
| Summarizer cooldown | Summarization threw (no provider, malformed response, etc.)      | Tier 1 disabled for **600 seconds**; result decision is `cooldown_active`.               |
| Force bypass        | `input.force = true`                                             | Both thrash and cooldown are ignored; the compression attempt runs.                      |

Thrash counters persist on `ContextState.thrashCounter`. Cooldown deadlines are in-memory only and reset on process restart.

### 9.9 Secret Redaction

`SecretRedactor.redact(text)` substitutes pattern-matched secrets with `[REDACTED]`. Patterns:

- Anthropic key (`sk-ant-…`), OpenAI key (`sk-…`), generic bearer tokens (`Bearer <token>`).
- AWS access key (`AKIA…`, `ASIA…`) and matching secret.
- Connection strings (`postgres://…@…`, `mongodb://…@…`, `redis://…@…`).
- GitHub tokens (`ghp_…`, `gho_…`, `ghu_…`, `ghs_…`, `ghr_…`).
- Private key blocks (`-----BEGIN … PRIVATE KEY-----`).
- Generic high-entropy env-var assignments (`KEY=…`) where the value passes an entropy threshold.

Redaction runs at three points:

1. Before content is sent to the summarizer LLM.
2. On the summarizer's output before persistence.
3. On bytes fetched by `@url:` reference resolution before injection.

### 9.10 Per-Thread Summary Persistence

**Collection:** `context_states` (see §4.18 for schema).

On `prepare()` entry, `SummaryStore.load(threadID)` rehydrates the prior summary. On `summarized` decision, `SummaryStore.save(threadID, …)` persists the new summary and increments `summaryGenerations`. Stale-summary guards force a from-scratch regeneration when either:

- `summaryGenerations >= CONTEXT_SUMMARY_MAX_GENERATIONS` (default 10), or
- `summaryUpdatedAt` is older than `CONTEXT_SUMMARY_MAX_AGE_DAYS` (default 7).

When a thread is deleted, the corresponding `context_states` document is removed in the same call path.

### 9.11 Context References

`ContextReferencePreprocessor.preprocess(message, ctx)` expands inline references in the user's message **before** it reaches the orchestrator. Feature-gated by `CONTEXT_REFERENCES_ENABLED` (default `false`).

| Reference                  | Resolver behavior                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `@file:path[:start-end]`   | Reads `WORKSPACE_DIR/path`. Optional line range. Goes through `PathValidator` (§23) for safety. |
| `@folder:path`             | Lists directory; first 50 entries with sizes.                                                |
| `@diff`                    | `git diff` against working tree (unstaged).                                                  |
| `@staged`                  | `git diff --staged`.                                                                         |
| `@git:<ref>`               | `git show <ref>`.                                                                            |
| `@url:<url>`               | Internal `web_fetch` with `URLValidator` (§23); body redacted, capped at 100 KB.            |

A per-message token budget caps expansion to **20% of the model's context window**. If expansion would exceed it, later references collapse to `[Reference omitted: token budget exceeded]`. Each successful expansion emits a `context.reference.expanded` SSE event.

### 9.12 Stream Events

| Event                           | Data                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `context.compression.started`   | `{ provider, modelID, beforeTokens }`                                         |
| `context.compression.completed` | `{ decision, beforeTokens, afterTokens, pruned, summary?, auxModelFailure? }` |
| `context.compression.skipped`   | `{ reason: 'thrash' \| 'cooldown', detail }`                                  |
| `context.reference.expanded`    | `{ kind, target, injectedTokens }`                                            |

See §8 for the event envelope and SSE transport.

---

## 10. Tool System

### Tool Interface

```typescript
interface Tool<TParams extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: TParams; // Zod schema
  parallelSafe?: boolean; // Default: false
  getResources?(
    args: z.infer<TParams>,
    context: ToolExecutionContext,
  ): ToolResource[];
  execute(
    args: z.infer<TParams>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
  // Optional: render a one-line summary of a completed call for context compaction.
  // When omitted, the context renderer falls back to a generic `[name] keyArgs (size)`.
  // See §9.6.
  renderResultSummary?(args: z.infer<TParams>, result: unknown): string;
}

interface ToolExecutionContext {
  threadID: string;
  runID: string;
  userID?: string;
  agentID: string;
  sandbox?: SandboxContext;
  delegationDepth?: number;
  metadata?: Record<string, unknown>;
}

interface ToolExecutionResult {
  success: boolean;
  result: unknown;
  error?: string;
}
```

### Tool Registry

- Tools are stored in a `Map<string, Tool>`.
- A mutex enforces serial execution for non-`parallelSafe` tools.
- `toFilteredToolSet(context, policy)` applies the agent's `ToolPolicy` (allow/deny list) before passing tools to the LLM.

### Tool Policy Filtering

```typescript
interface ToolPolicyFilter {
  mode: 'allow' | 'deny';
  tools: string[];
}
```

- `allow`: Only tools in the list are available
- `deny`: Tools in the list are blocked; all others available

### Loop Detection

The `LoopDetectionService` monitors tool call patterns per run and triggers circuit breakers:

| Pattern           | Window       | Threshold   | Description                                |
| ----------------- | ------------ | ----------- | ------------------------------------------ |
| `exact_repeat`    | Last 5 calls | 3 identical | Same tool + identical args called 3+ times |
| `ping_pong`       | Last 6 calls | A-B-A-B     | Two tools alternating                      |
| `no_progress`     | Consecutive  | 3 failures  | Same tool failing with same error          |
| `circuit_breaker` | All calls    | 25 total    | Hard limit on tool calls per run           |

Args are hashed with SHA-256 for comparison. Detection data is cleared on run completion.

**Circuit breaker behavior:** When the circuit breaker fires, the orchestrator injects a system message forcing a final answer without tools, then does one last model call (without tools in the tool set) to produce a text response before completing the run. Non-circuit-breaker loop detections inject a warning message but allow the loop to continue.

### Registered Tools (33 core + MCP)

#### File Operations

| Tool          | Parameters                                                                | Parallel | Description                                                 |
| ------------- | ------------------------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `read`        | `path`, `encoding?` (utf-8/base64)                                        | Yes      | Read file or list directory. Max 512KB.                     |
| `write`       | `path`, `content?`, `operation?` (write/append/mkdir/delete), `encoding?` | No       | Write, append, mkdir, or delete files. Creates parent dirs. |
| `edit`        | `path`, `old_text`, `new_text`, `all?`                                    | No       | Find and replace text in file. Returns replacement count.   |
| `apply_patch` | `path`, `patch`                                                           | No       | Apply unified diff. Hunks applied in reverse order.         |

#### Runtime Execution

All four runtime tools are gated by `ENABLE_SHELL_TOOL=true`. When disabled (default), they return a descriptive error without executing.

| Tool             | Parameters                                                                          | Parallel | Description                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `exec`           | `command`, `cwd?`, `timeoutMs?` (30s)                                               | No       | Execute shell command. Max output 64KB. Sandbox-aware.                                   |
| `shell`          | `script`, `cwd?`, `timeoutMs?` (30s)                                                | No       | Execute multi-line shell script via `/bin/sh`. Sandbox-aware.                            |
| `process`        | `operation` (start/list/output/kill), `command?`, `processID?`, `notifyOnComplete?` | No       | Background process management. Auto-cleanup after 5 min. Max 64KB output per stream. Processes are scoped to the thread that started them; `list`/`output`/`kill` cannot observe or affect processes owned by other threads. |
| `code_execution` | `language` (javascript/typescript/python), `code`, `timeoutMs?` (15s)               | No       | Run code with tool bridge. Generates helper libraries (`sera_tools.js`/`sera_tools.py`). |

**Code Execution Tool Bridge:**

- HTTP server on `127.0.0.1:0` (random port)
- Authentication: `X-Bridge-Token` header with random 32-byte secret
- Rate limit: 100 requests/second
- Max request body: 1MB
- Whitelisted tools: `read`, `web_fetch`, `web_search`, `memory_search`, `memory_get`
- Helper functions: `sera()`, `seraRead()`, `seraFetch()`, `seraSearch()`, `seraMemorySearch()`

#### Web & Search

| Tool         | Parameters                                                                                              | Parallel | Description                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| `web_fetch`  | `url`, `method?`, `headers?`, `body?`, `timeoutMs?` (30s)                                               | Yes      | HTTP request. Max response 100KB. URL validated.                           |
| `web_search` | `query`, `maxResults?` (5), `freshness?`, `type?` (web/news)                                            | Yes      | Brave Search API. Supports operators: "exact", -exclude, site:, filetype:. |
| `x_search`   | `query`, `maxResults?` (10), `sortOrder?` (recency/relevancy)                                           | Yes      | X/Twitter search. Returns tweet text, author, metrics.                     |
| `browser`    | `action` (navigate/screenshot/content/click/type/evaluate), `url?`, `selector?`, `text?`, `javascript?` | No       | Puppeteer browser automation. Persistent browser instance.                 |

#### Media

| Tool             | Parameters                                       | Parallel | Description                                                       |
| ---------------- | ------------------------------------------------ | -------- | ----------------------------------------------------------------- |
| `image`          | `source` (URL or file path), `question?`         | Yes      | Image analysis via OpenAI gpt-4o-mini. Supports PNG/JPG/GIF/WebP. |
| `image_generate` | `prompt`, `size?`, `quality?` (standard/hd)      | Yes      | DALL-E 3 image generation.                                        |
| `tts`            | `text` (max 4096), `voice?`, `model?`, `format?` | Yes      | OpenAI text-to-speech. Returns base64 audio.                      |

#### Memory

| Tool            | Parameters                                | Parallel | Description                                     |
| --------------- | ----------------------------------------- | -------- | ----------------------------------------------- |
| `memory_search` | `query`, `limit?` (5), `threshold?` (0.7) | Yes      | Semantic similarity search over user memories.  |
| `memory_get`    | `tags?`, `limit?` (20)                    | Yes      | Retrieve memories, optionally filtered by tags. |

#### Session Search

| Tool             | Parameters                 | Parallel | Description                                                               |
| ---------------- | -------------------------- | -------- | ------------------------------------------------------------------------- |
| `session_search` | `query`, `maxResults?` (5) | Yes      | Semantic search over chat history. Returns matches with relevance scores. |

#### Messaging & Communication

| Tool            | Parameters                                                                                                                         | Parallel | Description                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `message`       | `chatID`, `content`, `role?` (assistant/system)                                                                                    | No       | Append message to a chat.                                                   |
| `agent_message` | `targetAgentID`, `message`, `maxSteps?`, `waitForResult?`, `timeoutMs?`                                                            | No       | Inter-agent messaging. Max delegation depth: 2. Validates messaging policy. |
| `cron`          | `operation` (create/list/delete/enable/disable), `schedule?`, `command?`, `description?`, `script?`, `contextFromJobID?`, `jobID?` | No       | Manage cron jobs. Schedule format: `minute hour day month weekday`.         |

#### Session & Agent Management

| Tool               | Parameters                                                                                                   | Parallel | Description                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------- |
| `sessions_list`    | `limit?` (20), `status?`                                                                                     | Yes      | List threads with latest run status.                  |
| `sessions_history` | `chatID`, `limit?` (50), `offset?`                                                                           | Yes      | Load conversation messages from a chat.               |
| `sessions_spawn`   | `goal?`, `agentID?`, `maxSteps?`, `maxIterations?`, `waitForResult?`, `timeoutMs?`, `tasks?`, `concurrency?` | No       | Spawn one or more autonomous agent sessions.          |
| `sessions_yield`   | `message?`                                                                                                   | No       | Yield the current turn until subagent results arrive. |
| `session_status`   | `threadID`, `runID?`                                                                                         | Yes      | Get thread/run/agent state snapshot.                  |
| `subagents`        | `operation` (list/status/cancel), `runIDs?`, `threadID?`                                                     | No       | Manage sub-agent runs.                                |
| `agents_list`      | `includeTools?`, `enabledOnly?`                                                                              | Yes      | List configured agents.                               |

#### Task Planning

| Tool        | Parameters                                                                                                                               | Parallel | Description                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| `task_plan` | `operation`, `goal?`, `tasks?`, `planID?`, `taskID?`, `status?`, `result?`, `runID?`, `waitMeta?`, `expectedRevision?`, `key?`, `value?` | No       | Multi-step task planning with optimistic concurrency. |

#### Skills & Triggers

| Tool      | Parameters                                                                                                                                   | Parallel | Description                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------- |
| `skills`  | `operation` (list/get/create/update/delete/list_files/read_file/add_file/update_file/remove_file), `name?`, `description?`, `content?`, etc. | No       | Manage reusable skills with versioned files. |
| `trigger` | `operation` (create/list/update/delete), `webhookPath?`, `command?`, `secret?`, `triggerID?`                                                 | No       | Manage webhook triggers.                     |

#### Agent Catalog Management

The `agent_management` tool exposes `AgentsService` CRUD to the agent. It is gated by `toolPolicy` only. Because the seeded default agent uses `{ mode: 'deny', tools: [] }` — which §4.3 defines as "no filtering, agent gets the full tool set" — the default agent has `agent_management` implicitly and functions as the architect persona out of the box. Operators can lock it down by switching the default to `{ mode: 'allow', tools: [...] }` (explicit allow-list) or by adding `agent_management` to the deny list. Hard-blocks (still enforced regardless of policy):

- **Self-mutation:** any operation where `args.agentID === context.agentID` is rejected. Agents cannot escalate their own privileges or pull the rug on themselves mid-run.
- **Default agent protection:** `delete` and `disable` are rejected when `agentID === 'default'`. The default agent is the router's last-resort fallback (§11); losing it locks operators out.

Approval gate (via `ToolApprovalService`, §29.6) fires for `toolPolicy.tools` mutations only:

- `create` with non-empty `toolPolicy.tools` — approval requested with the full tools list in the message.
- `update` whose `toolPolicy` differs from the current agent's (mode change or any tool added/removed) — approval requested.
- All other operations (rename, description, `enabled` flip, `modelOptions`, `messagingPolicy`, `sandboxConfig`, etc.) run without approval, consistent with the `cron`/`skills`/`trigger` pattern.

`agentID` must match `^[a-z0-9][a-z0-9-]*$` on create. `agentID` is never mutable on update — the parameter identifies the target, not the new ID.

| Tool               | Parameters                                                                                                                                                                                      | Parallel | Description                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `agent_management` | `operation` (create/update/get/list/delete/enable/disable), `agentID?`, `name?`, `description?`, `promptSlug?`, `modelOptions?`, `toolPolicy?`, `messagingPolicy?`, `sandboxConfig?`, `enabled?` | No       | CRUD over `AgentsService`. Approval-gated on `toolPolicy.tools` changes; cannot self-mutate or affect default. |

#### Cluster Git (GitOps)

The `cluster_git` tool is the canonical path for declarative cluster changes. It writes to the GitHub repo identified by `CLUSTER_REPO` on branch `CLUSTER_BRANCH`; FluxCD reconciles those commits into the live cluster. Writes are atomic at the GitHub Contents API (one call = one commit), so no local clone is maintained. `write_file` and `delete_file` gate through `ToolApprovalService` with a fingerprint over `(repo, branch, path, content-sha256, message)` so each commit must be approved individually.

| Tool          | Parameters                                                                                | Parallel | Description                                                                            |
| ------------- | ----------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `cluster_git` | `operation` (list_files/read_file/write_file/delete_file/list_commits), `path?`, `content?`, `message?`, `pathPrefix?`, `limit?` | No       | Read/write the Flux-watched cluster repo. Reads run immediately; writes/deletes require approval. Disabled if `CLUSTER_REPO` or `GITHUB_PAT` is unset. |

#### Kubernetes (Direct Cluster Access)

The `kubectl` tool exposes the cluster directly via the `@kubernetes/client-node` SDK. `KUBECONFIG` must contain the **raw kubeconfig YAML** (not a file path) — this matches SERA's containerized deployment model where the kubeconfig is injected from a Kubernetes Secret rather than mounted as a file. `KUBE_CONTEXT` optionally pins to a specific context within that kubeconfig. Read operations run without approval. All mutating operations gate through `ToolApprovalService` with a fingerprint over `(operation, namespace, kind, name[, command, manifest-sha256])`. In normal operation the agent should prefer `cluster_git` for declarative changes (Flux will revert `kubectl`-applied state on the next reconcile); `kubectl` mutations exist as a break-glass capability for diagnostics, emergencies, or when Flux itself is degraded. `logs` and `exec` cap output at 64KB; `exec` enforces a 30s timeout. `port-forward` is intentionally omitted (synchronous-tool mismatch).

| Tool      | Parameters                                                                                                                                                  | Parallel | Description                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `kubectl` | `operation` (list/get/describe/logs/events/top_pods/top_nodes/apply/delete/delete_pod/scale/rollout_restart/rollout_undo/cordon/uncordon/drain_pod/exec/patch), `kind?`, `name?`, `namespace?`, `allNamespaces?`, `manifest?`, `replicas?`, `tailLines?`, `container?`, `command?`, `patch?`, `patchType?`, `gracePeriodSeconds?` | No       | Direct cluster management via `@kubernetes/client-node`. Reads run immediately; mutations require approval. |

#### MCP Tools

MCP tools are registered asynchronously 2 seconds after bootstrap. Each MCP tool is adapted from MCP protocol definitions to the SERA `Tool` interface. Tool names are prefixed with `mcp_{serverName}_`. All MCP tools are `parallelSafe: true`.

---

## 11. Agent Configuration

### Multi-Agent Architecture

SERA supports multiple named agents, each with its own configuration, tool policy, model preferences, and messaging policy. A routing system determines which agent handles each request.

### Default Agent

On first boot, `AgentsBootstrapService` seeds:

- Agent: `agentID: 'default'`, `name: 'SERA'`, `description: 'Default agent — handles all unrouted requests'`, `toolPolicy: { mode: 'deny', tools: [] }`
- Binding: `bindingType: 'default'`

The empty `toolPolicy.tools` array is intentional: per §4.3, an empty list means **no filtering** regardless of `mode`, so the default agent receives every registered tool — including `agent_management` (§10). This makes the default agent the de-facto **architect persona** out of the box: it can create, update, and disable other agents at the user's request without further configuration. The `agent_management` hard-blocks (self-mutation rejected; `default` cannot be deleted or disabled) still apply, so the default cannot brick itself. Operators who want a more restrictive default can switch it to `{ mode: 'allow', tools: [...] }` with an explicit list or add `agent_management` to a deny list.

### Agent Routing

`AgentRouterService.resolve(context)` determines the agent for a request:

1. **User binding** — `bindingType: 'user'`, `bindingValue` matches `userID`
2. **Channel binding** — `bindingType: 'channel'`, `bindingValue` matches `chatID` or `threadID`
3. **Default binding** — `bindingType: 'default'`
4. **null** — No agent matched

Each tier filters BOTH the binding's `enabled` flag and the target agent's `enabled` flag, sorted by `priority` descending (highest priority wins). A binding pointing at a disabled agent is treated as if the binding did not exist, falling through to the next tier. If no tier resolves to an enabled agent, the resolver returns `null`.

### Inter-Agent Messaging

The `agent_message` tool enables agent-to-agent communication:

- Sender's `messagingPolicy.enabled` must be `true`
- If `messagingPolicy.allowedAgents` is non-empty, target must be in the list
- Target agent must be enabled
- Maximum delegation depth: 2 (prevents infinite recursion)
- Messages are prefixed with `[Message from agent "{name}" ({agentID})]`

---

## 12. Actions System

Actions are backend-only operations (distinct from tools) that can require user confirmation before execution.

### Action Interface

```typescript
interface BackendAction<TParams extends z.ZodType> {
  name: string;
  description: string;
  parameters: TParams;
  requiresConfirmation?: boolean;
  execute(
    args,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult>;
}
```

### Registered Actions

| Action                   | Parameters                                                                                                    | Confirmation | Description                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `save_memory`            | `content`, `tags?`                                                                                            | No           | Save fact to long-term memory                                                      |
| `search_memory`          | `query`, `limit?`                                                                                             | No           | Search long-term memory                                                            |
| `delete_memory`          | `memoryID`                                                                                                    | Yes          | Delete a specific memory                                                           |
| `send_notification`      | `title`, `message`, `level?` (info/warning/error/success)                                                     | No           | In-chat UI signal emitted as a `text.done` SSE event with a `notification` payload |
| `send_push_notification` | `title?`, `message`, `priority?` (min/low/default/high/max), `tags?`, `click?`, `actions?` (view/http, max 3) | No           | Off-session device push via ntfy; surfaces transport failures as `success: false`  |
| `request_confirmation`   | `message`, `actionName`, `actionArgs?`, `timeoutMs?` (5 min)                                                  | No           | Pause run and wait for user approval                                               |

### Push Notification Transport

- `send_push_notification` publishes through `NtfyService` (`src/agent/ntfy/`), an injectable Nest provider exported by `NtfyModule` so cron, triggers, and commitments can reuse it later without going through the action layer.
- Auth is bearer-only; `NtfyService` validates the `tk_` prefix at construction and throws if the token is misconfigured.
- Transport uses JSON publish mode (`POST {NTFY_API_URL}`) with a 10s `AbortController` timeout. Priority strings map to ntfy's 1–5 internally.
- Failures (non-2xx, network, timeout) propagate as thrown errors; the action wraps them into `{ success: false, error }` so the agent can react instead of assuming delivery.

### Confirmation Flow

1. Action calls `request_confirmation`
2. `StateService.addPendingConfirmation()` creates a pending confirmation (durable, Mongo-backed)
3. Action subscribes to the confirmation's Redis Pub/Sub channel **before** the next step (see §12.x ConfirmationSignal). Order matters: subscribe first, then re-read the store, so a resolution landing in the gap is caught by the post-subscribe store read instead of being lost.
4. `confirmation.required` SSE event is emitted
5. Action awaits `Promise.race([signal, timeout])` — no polling
6. User calls the `resolveConfirmation` Next.js Server Action in SERAUI, which proxies `POST /agent/confirm/:threadID/:confirmationID`
7. `StateService.resolveConfirmation()` updates status in Mongo
8. Controller publishes the decision to the Redis channel (`ConfirmationSignal.publish`) and emits `confirmation.resolved` + `approval.resolved` SSE events
9. Whichever pod holds the awaiting action wakes from the subscription and returns the decision (`approved` / `rejected` / `timed_out`)

The Mongo write remains the system of record. Pub/Sub is only a wake-up wire; if it drops a message (Redis restart, network blip, pod reconnect), the next subscriber start performs a `getConfirmation()` re-read and surfaces an already-resolved entry without waiting. The 5-minute deadline still triggers `StateService.tryExpireConfirmation()`, which atomically removes the confirmation **only if** it is still `pending`. If a concurrent `resolveConfirmation` already transitioned the entry, the atomic claim fails and the resolved decision is returned to the agent instead of a silent `timed_out`.

### ConfirmationSignal Service

Located at `src/agent/state/confirmation-signal.service.ts`. Wraps a dedicated Redis client (subscriber + publisher pair — `node-redis` requires a separate connection for subscribe mode).

```typescript
interface ConfirmationSignal {
  publish(threadID: string, confirmationID: string, decision: { status: 'approved' | 'rejected'; feedback?: string }): Promise<void>;
  awaitResolution(threadID: string, confirmationID: string, timeoutMs: number, signal?: AbortSignal): Promise<{ status: 'approved' | 'rejected'; feedback?: string } | 'timeout'>;
}
```

- Channel name: `sera:confirm:<threadID>:<confirmationID>`. Thread-scoped to keep per-channel cardinality bounded and to align with the existing run/thread sharding.
- `awaitResolution` first calls `subscribe`, then performs one `StateService.getConfirmation` re-read. If the entry is already resolved, it unsubscribes and returns immediately — this is the "subscribe-then-check" race fix.
- The returned Promise resolves on either the first published message **or** the timeout firing. The race is settled exactly once; the loser is cancelled and the subscription is torn down in a `finally` block.
- Reuses the existing `REDIS_URL` configuration. The subscriber connection is a single shared client multiplexing all confirmation channels by `confirmationID` filter inside the message handler; no per-confirmation connection cost.
- Unit tests must cover: (a) publish-before-subscribe race resolved via the re-read path, (b) timeout firing without a publish, (c) publish arriving while awaiter is in the re-read window, (d) Redis disconnect mid-wait reverts to the existing atomic-expire backstop.

### Approval vs Confirmation Events

Two event channels surface the same underlying pending-confirmation lifecycle: `confirmation.required` / `confirmation.resolved` originate from action-layer pauses (`request_confirmation`, `delete_memory`, …) while `approval.requested` / `approval.resolved` / `approval.expired` (§29.6) originate from tool-layer gating (`exec`, `shell`, `process`, `code_execution`). The durable store is unified, so when an entry transitions both channels emit: the controller fires `confirmation.resolved` and `approval.resolved` together on user POST, and the confirmation action fires `approval.expired` when it claims a timeout. Consumers match by `confirmationID` against whichever `.required`/`.requested` event they originally observed.

---

## 13. Memory System

### Overview

The memory subsystem stores per-user long-term facts and conversation context that survive across runs and threads. It is multi-tenant, scoped on every read and write to the authenticated `userID`, and structured so the same store can be sliced further by `agentID`, `threadID`, or `projectID` at query time.

The implementation is native to SERA — there is no third-party memory library in the data path. The previous Mem0 OSS dependency has been removed: it forced a paraphrase-on-write (`infer:true`) extraction model that was lossy and non-deterministic, scanned the entire user corpus for ownership checks on delete, and exposed only flat tag filtering. The new system is built directly on the existing Qdrant cluster, uses native sparse + dense vectors with payload-indexed filtering, and treats the conversation as **verbatim source-of-truth** rather than as a paraphrasing target.

### Design Principles

1. **Verbatim storage.** Conversation pairs are stored as the original user/assistant text. No LLM-driven extraction at write time. The retrieval pipeline does the smart filtering, not the writer. This makes writes deterministic, audit-friendly, and reversible — re-running the same transcript twice produces the same memory IDs, and a corrupted/over-eager paraphrase can never silently rewrite history.
2. **Hybrid retrieval.** Every query fans out across dense (semantic) and sparse (lexical) signals, then fuses with Reciprocal Rank Fusion (RRF). Recency and confidence are applied as post-fusion modifiers so a memory that is highly relevant but stale ranks behind a recent equally-relevant one.
3. **Scoped, not flat.** Memories carry first-class `agentID`, `threadID`, and `projectID` fields stored as payload-indexed filters in Qdrant. Tag arrays remain available for ad-hoc grouping but are not the primary scoping mechanism. Scope filters are O(log N) via payload indexes — not O(N) post-fetch as in the prior Mem0 implementation.
4. **Lifecycle.** Memories have an explicit `confidence ∈ [0, 1]` and decay against time-since-last-access. A daily consolidator deduplicates near-identical entries and demotes long-unused ones. The store does not grow unboundedly per user.
5. **Pluggable backend.** `MemoryService` consumes a `MemoryBackend` interface. The only shipped implementation is `QdrantMemoryBackend`, but the interface is sized so a future Postgres, hybrid, or local-disk backend can drop in without touching `RunLifecycleService`, `OrchestratorService`, `PromptBuilderService`, the tool layer, the action layer, or `MemoryKnowledgeProvider`.

### Architecture

```
MemoryService                           ← public surface (the only thing callers see)
   │
   ├── MemoryBackend  (interface)       ← swap point
   │     └── QdrantMemoryBackend        ← shipped implementation
   │           ├── dense vectors        (OpenAI embeddings)
   │           ├── sparse vectors       (BM25-style with Qdrant IDF modifier)
   │           └── payload indexes      (user_id, agent_id, thread_id, project_id, confidence, created_at, last_read_at)
   │
   ├── MemoryScorer                     ← RRF fusion + recency decay + confidence weighting
   ├── MemoryReranker (optional)        ← Haiku 4.5 final-stage rerank for getContextForQuery
   └── MemoryConsolidatorService        ← daily cron: dedupe + decay + expire
```

`MemoryService` is the only type imported by orchestrator, run-lifecycle, prompt-builder, tools, actions, controller, and the knowledge provider. The backend, scorer, reranker, and consolidator are private to the module.

### Storage Schema

**Collection:** `sera_memories` (single shared collection, multi-tenant by `user_id` filter).

**Named vectors:**

| Vector  | Dimension                   | Distance | Source                                                                |
| ------- | --------------------------- | -------- | --------------------------------------------------------------------- |
| `dense` | 1536 (default) / 3072       | Cosine   | OpenAI `text-embedding-3-small` (default) or `text-embedding-3-large` |
| `sparse`| variable (vocab-driven)     | Dot      | Local tokenizer with Qdrant server-side `modifier: "idf"`             |

The sparse vector is a hashed-token bag-of-words computed in-process — no external service, no IDF tracking on our side. Qdrant's `modifier: "idf"` applies inverse-document-frequency weighting at query time against the collection it lives in, which gives BM25-style behavior for free.

**Payload fields:**

| Field           | Type       | Indexed | Purpose                                                                  |
| --------------- | ---------- | ------- | ------------------------------------------------------------------------ |
| `user_id`       | keyword    | yes     | Tenant isolation; always present on every filter                         |
| `agent_id`      | keyword    | yes     | Scope by source agent (optional)                                         |
| `thread_id`     | keyword    | yes     | Scope by source thread (optional)                                        |
| `project_id`    | keyword    | yes     | Scope by user-defined project grouping (optional)                        |
| `confidence`    | float      | yes     | `[0, 1]`; user-saved = 1.0, auto-captured = 0.5, decayed over time       |
| `created_at`    | datetime   | yes     | Write timestamp; drives recency decay                                    |
| `last_read_at`  | datetime   | yes     | Updated asynchronously on retrieval hit; drives staleness decay          |
| `content`       | text       | no      | Verbatim memory text                                                     |
| `tags`          | keyword[]  | no      | Free-form labels (e.g. `preference`, `auto-extracted`, `commitment`)     |
| `source`        | keyword    | no      | `user-saved` / `run-extracted` / `imported` — provenance                 |
| `metadata`      | object     | no      | Pass-through; opaque to retrieval                                        |

`user_id` payload-indexed filter combined with vector search is the foundational pattern. Delete uses `(point_id, user_id)` filter — no full corpus scan as in the prior implementation.

### Confidence and Decay

| Source                                        | Initial confidence |
| --------------------------------------------- | ------------------ |
| `save_memory` action (explicit user save)     | `1.0`              |
| `MemoryService.add(...)` direct call          | configurable, default `1.0`            |
| Run extraction (`extractFromRun`)             | `0.5`              |

**Recency decay** is applied at query time, not at write time, so the stored confidence never drifts on its own:

```
ageDays   = (now - last_read_at) / 86_400_000
decay     = exp(-ageDays / MEMORY_DECAY_TAU_DAYS)        // τ default 90
effective = baseScore × (MEMORY_CONFIDENCE_WEIGHT × confidence + 1 - MEMORY_CONFIDENCE_WEIGHT) × decay
```

A memory is "alive" for years if it keeps getting read; it ranks lower if nothing has touched it in months. `last_read_at` is bumped opportunistically on retrieval hits via a fire-and-forget batch update so the read path stays fast.

### Retrieval Pipeline

`MemoryService.search(query, scope, options)` and `MemoryService.getContextForQuery(...)` both go through:

1. **Hybrid search.** Single Qdrant Query API call with two prefetches (dense + sparse) and `Fusion::Rrf`. Filtered by `user_id` and any provided scope. Default `prefetchLimit = 50`, `limit = 20` candidates returned for downstream scoring.
2. **Score fusion.** `MemoryScorer` applies confidence weighting and exponential recency decay (above formula) over the RRF score, producing a final effective score per candidate.
3. **Optional LLM rerank.** Only invoked from `getContextForQuery` (the per-session frozen-context capture) and only when `MEMORY_RERANK_ENABLED=true`. `MemoryReranker` sends top-20 candidates + the query to Haiku 4.5 via the existing `ModelRouterService` and asks it to return the most relevant top-K. Failure is non-fatal — the un-reranked top-K is returned. `memory_search` tool calls never invoke rerank to avoid per-tool-call LLM cost.
4. **Top-K return.** Default `K = 5` for context, `K = 10` for explicit `memory_search`.
5. **Touch.** `last_read_at` is updated on every returned point asynchronously after the response is sent to the caller.

### Public Surface

`MemoryService` exposes a smaller, scope-aware API than the prior implementation:

| Method                                                  | Description                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `add(userID, content, options?)`                        | Verbatim store. Options: `tags`, `agentID`, `threadID`, `projectID`, `confidence`, `source`, `metadata`                |
| `addPair(userID, userText, assistantText, options?)`    | Convenience for run extraction — stores one verbatim record of the round-trip with `source: run-extracted` and `confidence: 0.5` |
| `search(userID, query, options?)`                       | Hybrid search. Options: `scope` (agent/thread/project), `limit`, `tags`, `minScore`                                    |
| `getContextForQuery(userID, query, options?)`           | Hybrid search + rerank, formatted as a prompt block. Options: `scope`, `limit`                                         |
| `getAll(userID, options?)`                              | Paginated list. Options: `scope`, `tags`, `limit`, `offset`. Sorted by `created_at` desc                               |
| `delete(userID, memoryID)`                              | Ownership-checked single delete via `(point_id, user_id)` filter                                                       |
| `extractFromRun(userID, userMessage, assistantMessage, scope)` | Called by `RunLifecycleService` after run completion (non-heartbeat). Wraps `addPair` with run-derived scope    |

There is no `getByTags(userID, tags)` — the equivalent is `search` or `getAll` with `tags`. There is no separate `extractAndStore` that runs LLM inference — `extractFromRun` writes verbatim.

### Tools, Actions, Controller

The shape of agent-facing tools and actions is preserved so prompts and skills continue to work, but the backing implementation runs through the new service:

| Surface         | Name              | Backed By                                                                              |
| --------------- | ----------------- | -------------------------------------------------------------------------------------- |
| Tool (read)     | `memory_search`   | `MemoryService.search` with current run scope (agentID/threadID) applied by default     |
| Tool (read)     | `memory_get`      | `MemoryService.getAll` with current scope                                              |
| Action (write)  | `save_memory`     | `MemoryService.add` with `confidence: 1.0`, `source: user-saved`                        |
| Action (read)   | `search_memory`   | `MemoryService.search`                                                                  |
| Action (delete) | `delete_memory`   | `MemoryService.delete` (`requiresConfirmation: true` retained)                          |

`MemoryController` keeps the same `/api/v1/memories` surface (`GET /` list, `DELETE /:id`) and the same `MemoryResponse` shape `{ id, content, tags, metadata, createdAt }`. The list endpoint returns memories sorted by `created_at` desc, scoped to the authenticated user. The Manage → Memories tab in SERAUI continues to work without changes.

### Knowledge Integration

`MemoryKnowledgeProvider` (registered per-request by `PromptBuilderService`) wraps `MemoryService.search` and exposes user memories to the knowledge layer's RRF context-builder. No change to the knowledge interface.

### Frozen Context Cache

`OrchestratorService` captures `getContextForQuery(...)` once per session into `frozenMemoryContext` and freezes it for the duration of the run, preserving the Anthropic prompt prefix cache. Mid-run writes update Qdrant but never mutate the system prompt within the active run. This invariant is preserved exactly as before — the only change is that the query path is now hybrid + reranked.

### Consolidation (Background Lifecycle)

`MemoryConsolidatorService` runs on a configurable interval (default daily) via the same `setInterval` pattern used by `SkillCuratorService`. Each cycle:

1. **Scrolls** the `sera_memories` collection in pages, grouping by `user_id`.
2. **Dedupes** within each user: any two points with cosine similarity ≥ 0.95 collapse into the higher-confidence-and-newer entry; the loser is deleted. The merged entry inherits the union of tags.
3. **Decays** confidence by a flat amount (default `0.02`) on points whose `last_read_at` is older than `MEMORY_STALE_DAYS` (default 30).
4. **Expires** any point whose post-decay confidence falls below `MEMORY_MIN_CONFIDENCE` (default 0.1).

The cycle is idempotent, batched (default 256 points / page), and emits a structured summary to the Nest logger.

### Environment Variables

| Variable                       | Default              | Description                                                              |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------ |
| `MEMORY_COLLECTION`            | `sera_memories`      | Qdrant collection name                                                   |
| `MEMORY_DECAY_TAU_DAYS`        | `90`                 | Time constant `τ` (days) for exponential recency decay                   |
| `MEMORY_CONFIDENCE_WEIGHT`     | `0.5`                | `[0, 1]` blend between flat score and confidence-weighted score          |
| `MEMORY_RERANK_ENABLED`        | `true`               | Enable LLM rerank in `getContextForQuery`                                |
| `MEMORY_RERANK_MODEL`          | `anthropic/claude-haiku-4-5` | Provider/model used by `MemoryReranker`                          |
| `MEMORY_PREFETCH_LIMIT`        | `50`                 | Qdrant prefetch candidates per branch (dense / sparse) before RRF        |
| `MEMORY_CONTEXT_LIMIT`         | `5`                  | Top-K returned by `getContextForQuery` after rerank                      |
| `MEMORY_SEARCH_LIMIT`          | `10`                 | Default top-K returned by `MemoryService.search`                         |
| `MEMORY_CONSOLIDATION_INTERVAL_MS` | `86400000`        | Consolidator cycle period (default 24h). `0` disables the cycle.         |
| `MEMORY_STALE_DAYS`            | `30`                 | Days of no read access before consolidator decays a memory               |
| `MEMORY_MIN_CONFIDENCE`        | `0.1`                | Post-decay confidence floor below which a memory is expired              |
| `MEMORY_DUPLICATE_THRESHOLD`   | `0.95`               | Cosine similarity at which two memories merge during consolidation       |

`OPENAI_EMBEDDING_MODEL` continues to drive the dense vector embedder. `QDRANT_URL` / `QDRANT_API_KEY` are unchanged. `MEMORY_NUDGE_INTERVAL` is retained — the in-loop reminder to save memories is independent of the storage layer.

### Migration From Mem0

There is no data migration. The Mem0 collection `mem0_memories` and the new collection `sera_memories` are disjoint; the old collection is orphaned at cutover. This is intentional and matches the user-approved nuke-and-rebuild scope — Mem0's paraphrased contents were not authoritative and re-extracting them would replay the original lossiness. New conversations populate `sera_memories` immediately on the first post-deploy run.

The `mem0ai` package and its `overrides` block are removed from `package.json`. The Qdrant cluster operator is responsible for deleting the orphan `mem0_memories` collection at their discretion.

### Phased Implementation Plan

Each phase is a self-contained, reviewable commit and includes a verification step before the next phase begins.

| Phase | Scope                                                                                                                                                                                                                                                          | Verification                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1     | Spec rewrite (this section).                                                                                                                                                                                                                                   | Spec review.                       |
| 2     | `MemoryBackend` interface + shared types (`MemoryRecord`, `MemoryScope`, `MemoryQuery`, `MemorySearchResult`). New dir layout: `src/agent/memory/{backend,scoring,lifecycle,reranker}/`.                                                                       | `npm run build`.                   |
| 3     | `QdrantMemoryBackend` with verbatim writes, hybrid (dense + sparse) search, scope filters, payload-indexed delete. Collection bootstrap on module init.                                                                                                       | `npm run build`.                   |
| 4     | `MemoryScorer` (RRF + recency decay + confidence weighting) and `MemoryReranker` (Haiku 4.5 final pass). Configuration knobs wired to `env.schema.ts`.                                                                                                          | `npm run build`.                   |
| 5     | `MemoryService` rewrite as the public surface over the backend + scorer + reranker. Old Mem0 service deleted in the same commit.                                                                                                                              | `npm run build`.                   |
| 6     | Rewire callers: `OrchestratorService.getContextForQuery`, `RunLifecycleService.extractFromRun`, `PromptBuilderService` knowledge provider, `MemorySearchTool` / `MemoryGetTool`, `SaveMemoryAction` / `SearchMemoryAction` / `DeleteMemoryAction`, `MemoryController`, `MemoryKnowledgeProvider`. | `npm run build` + `npm test`.      |
| 7     | `MemoryConsolidatorService` daily background job, registered in `MemoryModule`.                                                                                                                                                                               | `npm run build`.                   |
| 8     | Remove `mem0ai` from `dependencies` + `overrides`. Update lockfile.                                                                                                                                                                                           | `npm run build`.                   |
| 9     | Vitest unit tests: scorer (RRF fusion, decay, confidence), reranker (graceful fallback on LLM failure), consolidator (dedupe + decay + expire), scope filter encoding. Mocked Qdrant.                                                                          | `npm test`.                        |
| 10    | Lint + typecheck + test gate, push to `master`, await CI image build, `kubectl rollout restart` of the SERA Deployment, push notification on completion.                                                                                                       | Image SHA published; pod ready.    |

---

## 14. Knowledge System

### Architecture

The knowledge system uses a provider-based architecture for pluggable knowledge sources.

### Provider Interface

```typescript
interface KnowledgeProvider {
  name: string;
  search(query: KnowledgeQuery): Promise<KnowledgeResult[]>;
  addDocument?(document): Promise<KnowledgeDocument>;
  removeDocument?(documentID): Promise<boolean>;
}
```

### Registered Providers

| Provider                    | Name        | Backend                    | Description                                                |
| --------------------------- | ----------- | -------------------------- | ---------------------------------------------------------- |
| `DocumentKnowledgeProvider` | `documents` | Qdrant + OpenAI embeddings | Document chunks with semantic search                       |
| `MemoryKnowledgeProvider`   | `memory`    | MemoryService              | User memories as knowledge (created dynamically per query) |

### Document Provider

- **Collection:** `knowledge_chunks` (Qdrant)
- **Embedding:** OpenAI `text-embedding-3-small` by default (1536 dimensions; 3072 for `text-embedding-3-large`)
- **Chunk size:** 1000 chars (configurable)
- **Chunk overlap:** 200 chars (configurable)
- **Chunking strategy:** Paragraph breaks > sentence breaks > word breaks
- **Search:** Cosine distance, default min score 0.7

### Context Building

`KnowledgeService.buildContext(query, options?)` searches all registered providers plus any per-query `extraProviders`, sorts results by score, and returns `ContextItem[]`. `PromptBuilderService` passes a per-query `MemoryKnowledgeProvider` for the current user rather than registering user-specific memory globally. Context items are formatted into markdown sections by `formatContextForPrompt()` and appended to the system prompt.

---

## 15. Skills System

Skills are reusable, versioned knowledge units that the agent can learn and apply.

### Lifecycle

```
user/seed creates skill -> active
                              |
                     30 days no use
                              |
                              v
                           stale
                              |
                     90 days no use
                              |
                              v
                          archived
```

Protected skills (origin `seed` or with `seedHash`) are exempt from lifecycle transitions.

### Self-Improving Skills

**Skill Review** (`SkillReviewService`): After runs exceeding configured thresholds, the system reviews conversations for patterns worth capturing. Review signals (in priority order):

1. User corrected style/tone/format
2. User corrected workflow/sequence
3. Non-trivial technique or workaround emerged
4. Skill was wrong/missing/outdated
5. Complex multi-tool orchestration (5+ calls)

Actions taken (in preference order):

1. Update existing skill
2. Add support file to existing skill
3. Create new skill (origin: `agent`)
4. Do nothing

**Skill Curation** (`SkillCuratorService`): Runs periodically (default every 6 hours):

1. Lifecycle transitions (active -> stale -> archived)
2. Consolidation: When 5+ agent-created skills exist, uses LLM to merge overlapping skills. Absorbed skills are marked with `absorbedInto` field.

### Skill Files

Skills can contain supplementary files under restricted path prefixes:

- `references/` — Reference documentation
- `templates/` — Template files
- `scripts/` — Helper scripts

### GitHub Sync

Skills sync bidirectionally with a GitHub repository:

- Each skill is a directory with a `SKILL.md` file (YAML frontmatter + markdown content)
- Supplementary files in the directory are synced as skill files
- Composite SHA (from all files) tracks changes

### Skill Matching

`findRelevant(query, availableTools?)` finds skills by:

1. Text matching against name and description
2. Filtering by available tools (skills with `allowedTools` must match agent's tool set)
3. Ranking by match quality

Matched skills are formatted into the system prompt via `formatForPrompt(skills)` with their content and metadata.

Calling `findRelevant` also updates `lastUsedAt`, increments `usageCount`, and re-activates `stale` skills via a single `bulkWrite`. This bookkeeping is fire-and-forget — a failure logs a warning but does not block the prompt build. `lastUsedAt` is not consumed from the Redis cache (the curator queries Mongo directly), so cache invalidation is intentionally skipped to avoid a write storm on every prompt build.

---

## 16. Plugins System

Plugins enable dynamic extension of SERA's capabilities via npm packages.

### Plugin Interface

```typescript
interface SeraPlugin {
  name: string;
  version: string;
  description?: string;
  onRegister(context: PluginContext): Promise<void> | void;
  onUnregister?(): Promise<void> | void;
}

interface PluginContext {
  registerTool(tool: Tool): void;
  getConfig<T>(key: string): T | undefined;
  onPreToolCall(fn): void;
  onPostToolCall(fn): void;
  onPreLLMCall(fn): void;
  onPostLLMCall(fn): void;
  onSessionStart(fn): void;
  onSessionEnd(fn): void;
  logger: { log; warn; error; debug };
}
```

### Lifecycle

1. Plugin configs are stored in MongoDB
2. On module init, all enabled plugins are loaded via dynamic `import()`
3. `onRegister()` is called with a context that allows tool and knowledge registration
4. Plugins can be toggled (enabled/disabled) at runtime via the API
5. On disable, `onUnregister()` is called if defined

---

## 17. MCP Integration

SERA integrates with external tools via the Model Context Protocol (MCP).

### Configuration

MCP servers are configured in MongoDB with transport type (`stdio` or `sse`), connection details, and enabled state.

### Connection Flow

1. On module init, `McpClientService` connects to all enabled servers
2. For stdio: spawns process with `command` and `args`
3. For SSE: connects to `url`
4. Discovers available tools from each server
5. Tools are adapted to SERA's `Tool` interface via `adaptMcpTool()`

### Tool Naming

MCP tools are registered with the name format `mcp_{serverName}_{toolName}`. The adapter strips this prefix when calling the original MCP tool.

### SDK Loading

The MCP SDK (`@modelcontextprotocol/sdk`) is loaded lazily via dynamic import to avoid hard dependency failures.

---

## 18. Task Planning

The task planning system enables agents to break complex goals into ordered sub-tasks with state tracking and optimistic concurrency.

### Plan Lifecycle

```
planning -> executing -> completed | failed | cancelled
```

Plans created through the `task_plan` tool are inserted directly in `executing` state because the ordered task list is supplied up front. The schema default of `planning` only applies to raw document creation outside the service flow.

### Optimistic Concurrency

Updates accept an optional `expectedRevision` parameter. If the current revision doesn't match, the update is rejected. Every successful mutation increments `revision`.

### Plan Reconciliation

When a task is updated, the service checks if all tasks are in terminal states (`completed`, `failed`, `skipped`). If so, the plan status is automatically updated:

- All completed/skipped -> `completed`
- Any failed -> `failed`

### Shared State

Plans have a `stateJson` field for shared mutable state across tasks. State updates also support optimistic concurrency.

---

## 19. Triggers & Webhooks

Triggers allow external systems to invoke agent execution via HTTP webhooks.

### Webhook Endpoint

`POST /api/v1/webhooks/:path`

- Session auth is bypassed only for this route via `@WebhookProtected()`
- Route access is enforced by `WebhookAuthGuard`
- Requires `WEBHOOK_API_KEY` via `x-webhook-api-key` header or `Authorization: Bearer ...`
- Additionally authenticated via `x-webhook-secret` header when the trigger has a configured secret
- Payload is formatted as markdown and sent as the agent's goal
- Returns `{ runID, triggerID }` with HTTP 202 Accepted
- Agent executes asynchronously (maxSteps: 10, maxIterations: 2)
- Runs with `isHeartbeat: true` (skips memory extraction on completion)
- Uses synthetic `userID: 'webhook:{triggerID}'` (not a real user session)
- Tracks `executionCount` and `lastTriggeredAt`

### Trigger Resolution

1. `WebhookAuthGuard` extracts `:path` from URL
2. Validates the request API key against `WEBHOOK_API_KEY`
3. Looks up trigger by `webhookPath` (must be enabled)
4. If trigger has a `secret`, validates `x-webhook-secret` header
5. Injects trigger into request via `@WebhookTrigger()` decorator

---

## 20. Cron Scheduling

The cron system executes agent goals on configurable schedules.

### Schedule Format

Standard 5-field cron: `minute hour day month weekday`

Validated by regex: `^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$`

### Execution

- `CronSchedulerService` ticks every 60 seconds
- Finds enabled jobs where `nextRunAt <= now` (or `nextRunAt` is null)
- Creates a durable `scheduled_executions` record with `kind: 'cron'`, `targetID: jobID`, and `scheduledFor: nextRunAt`
- Advances the cron job's `nextRunAt` only after the durable execution exists
- Claims due `scheduled_executions` records with an atomic lease update; multiple backend instances may poll, but only one instance owns a given scheduled occurrence
- Executes each claimed job's `command` as an agent goal (maxSteps: 10, maxIterations: 2)
- Renews the execution lease while the agent run is active
- Marks the execution `completed`, `failed`, or `cancelled` from the persisted run state and updates `lastRunAt` / `lastRunID`
- Fallback `nextRunAt`: now + 30 minutes (if cron parsing fails)

Cron execution is at-least-once under crash recovery and duplicate-safe under normal horizontal operation. If a process dies while owning an execution, the lease expires and another instance can reclaim it until `SCHEDULED_EXECUTION_MAX_ATTEMPTS` is reached.

The `attempts` counter is incremented only on lease-expiry reclaims, not on the initial `pending → running` transition. A process that crashes between claim and the start of user-visible work therefore does not burn one of the configured retries — only an owner that actually held the lease (and lost it via expiry) consumes an attempt. `SCHEDULED_EXECUTION_MAX_ATTEMPTS` bounds reclaims, which means up to `MAX_ATTEMPTS + 1` total claims (one initial + N reclaims) before the occurrence is abandoned.

---

## 21. Heartbeat System

Heartbeats are periodic background agent runs for autonomous monitoring.

### Configuration

Each agent can have one heartbeat configuration specifying interval, active hours, checklist, and token limits.

### Execution

- `HeartbeatService` ticks every 60 seconds
- Finds configs where `nextRunAt <= now` (or null) and `enabled: true`
- Filters by `activeHours` (supports midnight wrap, timezone-aware via `Intl.DateTimeFormat`)
- When inside active hours, creates a durable `scheduled_executions` record with `kind: 'heartbeat'`, `targetID: agentID`, and `scheduledFor: nextRunAt`
- Advances the heartbeat config's `nextRunAt` only after the durable execution exists
- Claims due heartbeat executions with the same atomic lease mechanism as cron
- Builds message from `heartbeat` prompt slug or default template
- Executes as agent goal with `isHeartbeat: true` (maxSteps: 10, maxIterations: 2)
- Renews the execution lease while the run is active
- Marks the execution `completed`, `failed`, or `cancelled` from the persisted run state and updates `lastRunAt`
- Heartbeat runs skip memory extraction on completion

Heartbeat execution uses the same horizontal-scaling guarantees as cron. If a heartbeat is due but outside active hours, no execution is created and `nextRunAt` is not advanced; the config is rechecked on the next tick.

### Active Hours

If configured, heartbeats only fire within the specified window:

- `start`: Hour (0-23) when heartbeats can begin
- `end`: Hour (0-23) when heartbeats stop
- `timezone`: IANA timezone string (default: `UTC`)
- Supports midnight wrap (e.g., start: 22, end: 6 means 10 PM to 6 AM)

---

## 22. Usage Insights

### Cost Tracking

Every completed run records usage metrics including token counts, cost, duration, and tool calls.

### Pricing Table

| Model               | Input ($/MTok) | Output ($/MTok) | Cache Read ($/MTok) | Cache Write ($/MTok) |
| ------------------- | -------------- | --------------- | ------------------- | -------------------- |
| `claude-haiku-4-5`  | 0.80           | 4.00            | 0.08                | 1.00                 |
| `claude-sonnet-4-6` | 3.00           | 15.00           | 0.30                | 3.75                 |
| `claude-opus-4-7`   | 15.00          | 75.00           | 1.50                | 18.75                |
| `gpt-4o-mini`       | 0.15           | 0.60            | —                   | —                    |
| `gpt-4o`            | 2.50           | 10.00           | —                   | —                    |
| `o3`                | 2.00           | 8.00            | —                   | —                    |
| `gemini-2.0-flash`  | 0.10           | 0.40            | —                   | —                    |

Cost is calculated as: `(inputTokens + thinkingTokens) * inputRate + outputTokens * outputRate + cacheReadTokens * cacheReadRate + cacheWriteTokens * cacheWriteRate`. The result is stored as **integer cents** (USD × 100, rounded to the nearest cent). The `costCents` field, all aggregate totals (`totalCostCents`, per-provider and per-model `costCents`), and the runtime cost log line all express whole cents.

### Aggregation

`getAggregate(userID, opts?)` returns:

```typescript
interface AggregateResult {
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRuns: number;
  totalToolCalls: number;
  byProvider: Record<string, { runs; costCents; inputTokens; outputTokens }>;
  byModel: Record<string, { runs; costCents; inputTokens; outputTokens }>;
}
```

### Top Tools

`getTopTools(userID, limit?)` aggregates tool usage from chat message history via a MongoDB aggregation pipeline on `Chat.messages.toolCalls.toolName`. Returns per-tool invocation counts sorted descending. The `InsightsModule` imports both `UsageRecord` and `Chat` schemas for this.

---

## 23. Security

### Content Scanning

`ContentScannerService` provides threat scanning across 5 categories and is currently enforced on skill create/update payloads:

| Category            | Severity | Patterns                                                                     |
| ------------------- | -------- | ---------------------------------------------------------------------------- |
| `prompt_injection`  | High     | Instruction override, role reassignment, fake system messages, DAN/jailbreak |
| `role_hijack`       | High     | Persistent role change, behavioral override                                  |
| `credential_exfil`  | High     | API key/secret/password extraction, env var access, exfiltration endpoints   |
| `invisible_unicode` | Medium   | Zero-width sequences, bidirectional overrides                                |
| `code_injection`    | High     | eval/exec with dangerous imports, prototype pollution                        |

Content is marked safe only if no high-severity threats are detected.

### Command Validation

`CommandValidator` blocks dangerous shell commands:

- Disk destruction: `rm -rf /`, `mkfs`, `dd` to device
- System control: `shutdown`, `reboot`, `poweroff`, `halt`, `init 0`
- Service management: `systemctl stop/disable/mask`
- Permission abuse: `chmod 777`, `chown -R`, `sudo su`
- User management: `passwd`, `useradd`, `userdel`, `visudo`
- Network: `iptables -F`, `ufw disable`
- Process killing: `killall`, `pkill -9`
- Cron deletion: `crontab -r`
- Fork bombs: `:(){ :|:& };`

### Path Validation

`PathValidator` blocks access to sensitive paths:

- `.env` files
- `.git/` directory
- `node_modules/`
- `.ssh/`, `.aws/`, `.docker/`
- `id_rsa`, `*.pem` files
- `credentials`, `secrets.*` files
- Path traversal (`../`) outside workspace

### URL Validation

`URLValidator` blocks requests to:

- Localhost (`127.0.0.1`, `0.0.0.0`)
- Cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`)
- Private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- Link-local (169.254.0.0/16, fe80::\*)
- IPv6 private/loopback (::1, fc*, fd*)
- Only `http` and `https` protocols allowed

### Sandbox Execution

`SandboxRunnerService` provides process isolation via Linux `unshare`:

| Resource             | Limit                      |
| -------------------- | -------------------------- |
| Virtual memory       | `memoryMb * 1024` KB       |
| CPU time             | `timeoutMs / 1000` seconds |
| Max processes        | 64                         |
| Max file descriptors | 256                        |
| Max file size        | 65536 blocks               |

**Namespace isolation** (probed on init):

- PID namespace: `unshare --pid --fork`
- Network namespace: `unshare --net` (unless `networkEnabled`)

Environment is sanitized to: `HOME`, `PATH`, `TMPDIR`, `LANG`, plus custom `envVars`.

### Runtime Tool Environment

`exec`, `shell`, `process`, and `code_execution` all apply the same `HOME` / `PATH` / `TMPDIR` / `LANG` allowlist to the child-process env even when the sandbox is OFF, via the shared `buildToolEnv()` helper in `tool-utils`. This prevents `AUTH_SECRET`, provider API keys, the Mongo URI, NTFY tokens, and other process-level secrets from leaking into user-supplied scripts. `code_execution` additionally injects `SERA_BRIDGE_URL` / `SERA_BRIDGE_SECRET` for the tool-bridge helper libraries.

---

## 24. Chat Management

### Auto-Title Generation

When a chat is created, the first user message (up to 500 chars) is sent to `claude-haiku-4-5` to generate a 5-7 word title. On failure, falls back to first 50 chars + "...".

### Chat Operations

| Operation                 | Description                                                                 |
| ------------------------- | --------------------------------------------------------------------------- |
| `create`                  | Create chat from messages, auto-generate title                              |
| `createWithUserMessage`   | Create chat with single message, title generated async                      |
| `findAllByUser`           | List user's chats, sorted by updatedAt desc, excludes messages              |
| `findOne`                 | Get chat by ID, enforces user ownership                                     |
| `update`                  | Replace messages array, enforces ownership                                  |
| `updateModel`             | Update model field on chat                                                  |
| `appendMessage`           | Push single message to chat's messages array                                |
| `loadConversationHistory` | Get `[{role, content}]` array for LLM context                               |
| `searchMessages`          | Full-text search across user's chats, returns matches with relevance scores |
| `remove`                  | Delete chat, enforces ownership                                             |

### Ownership

All chat operations verify `userID` matches the chat's `userID`. Mismatches throw `ForbiddenException`.

---

## 25. Prompt Management

### Variable Substitution

Prompts support `{{variable}}` placeholders:

| Variable              | Source                |
| --------------------- | --------------------- |
| `{{agentName}}`       | Agent config name     |
| `{{agentID}}`         | Agent config ID       |
| `{{userName}}`        | Session user name     |
| `{{userID}}`          | Session user sub      |
| `{{currentDate}}`     | Current date          |
| `{{currentTime}}`     | Current time          |
| `{{currentDateTime}}` | Current date and time |

### Prompt Inheritance

Prompts can extend other prompts via the `extends` field. Resolution walks the chain (max 10 levels), concatenating content with `\n\n`. Circular references are detected and rejected.

### Caching

Prompt content is cached in Redis (`prompt:{slug}`, TTL 300s). Cache is invalidated on upsert and delete.

### GitHub Sync

On module init, prompts are synced from the configured GitHub repository. Each prompt is a markdown file with optional YAML frontmatter containing `extends`, `description`, and `metadata`.

---

## 26. GitHub Sync

`GitHubSyncService` provides bidirectional sync between MongoDB and GitHub repositories.

### Sync Flow (Prompts)

1. Fetch tree from `GITHUB_PROMPTS_REPO` (master branch)
2. Filter to top-level `.md` files
3. For each file:
   - Compare `seedHash` with file's SHA (skip if unchanged)
   - Fetch file content, parse YAML frontmatter
   - Create or update in MongoDB
4. Store latest commit SHA in Redis

### Sync Flow (Skills)

1. Fetch tree from `GITHUB_SKILLS_REPO`
2. Group files by top-level directory
3. For each directory with a `SKILL.md`:
   - Compute composite SHA from all files
   - Compare with `seedHash` (skip if unchanged)
   - Fetch `SKILL.md` and supplementary files
   - Create or update in MongoDB with files array
4. Store latest commit SHA

### Push to GitHub

When prompts or skills are created/updated via the API, changes are pushed back to GitHub:

- Prompts: serialized as YAML frontmatter + markdown content
- Skills: `SKILL.md` file + supplementary files in skill directory
- Handles 409 conflicts by refetching SHA and retrying once

### Frontmatter Format

**Prompts:**

```yaml
---
extends: parent-slug
description: Description text
metadata:
  key: value
---
Prompt content here...
```

**Skills:**

```yaml
---
description: Skill description
license: MIT
compatibility: v1
allowed-tools: tool1 tool2 tool3
metadata:
  key: value
---
Skill content here...
```

The `allowed-tools` field is stored as a space-separated string in frontmatter and converted to an array (`allowedTools`) in the schema.

---

## 27. Storage

### Attachment Object Storage

`AttachmentsService` stores durable attachment bytes in S3-compatible object storage and stores attachment metadata in MongoDB.

| Property       | Value                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| Backend        | S3-compatible object storage (MinIO or AWS S3)                         |
| Bucket         | `OBJECT_STORAGE_BUCKET`                                                |
| Key format     | `attachments/{safeUserID}/{attachmentID}`                              |
| Metadata store | MongoDB `attachments` collection                                       |
| Access         | Private bucket; clients access bytes through authenticated SERA routes |

The upload endpoint (`POST /agent/attachments`) accepts a multipart `file` field. SERA detects `kind` from the MIME type (`image/*` => `image`, otherwise `file`) and returns an `Attachment` summary. Chat requests send `attachmentIDs` separately from `message`; text is never overloaded with attachment markers.

During orchestration, `AttachmentMessageResolverService` fetches object bytes from storage and converts message attachments into AI SDK content parts:

- `image` attachments become `{ type: 'image', image: Buffer, mediaType }`.
- `file` attachments become `{ type: 'file', data: Buffer, mediaType, filename }`.

### Upload Constraints

- Max file size: 25 MiB
- File field name: `file`
- Returns: `Attachment`

---

## 28. Autonomy Features

### 28.1 Wall-Clock Timeout

Autonomous runs (cron, heartbeat, webhook) enforce a wall-clock timeout in addition to iteration limits. The orchestrator checks elapsed time at the start of each iteration and aborts if `wallClockTimeoutMs > 0` and `Date.now() - runStartTime >= wallClockTimeoutMs`. The run is marked `cancelled`. Interactive runs default to `wallClockTimeoutMs: 0` (no limit).

### 28.2 Memory Nudges

Every N tool calls (configured by `MEMORY_NUDGE_INTERVAL`, default 10), the orchestrator injects a user-role message nudging the agent to consider saving important facts via memory tools. Nudges are skipped for heartbeat runs (`isHeartbeat: true`). The counter resets each run and is not persisted.

### 28.3 Sessions Yield

The `sessions_yield` tool allows an agent to explicitly end its turn and receive subagent results as the next message, eliminating polling loops.

**Flow:**

1. Agent spawns subagents via `sessions_spawn` with `waitForResult: false`
2. Agent calls `sessions_yield` with an optional message
3. Tool sets `custom.yielding = true` on the thread along with `yieldAgentID`, `yieldUserID`, `yieldChatID`
4. Orchestrator detects the yield and completes the run normally
5. When a subagent completes, `completeRun()` checks if the subagent's thread has `custom.parentThreadID`
6. If the parent thread has `custom.yielding = true`, a new run is started on the parent with the subagent results as the message

The `sessions_spawn` tool sets `custom.parentThreadID` on the subagent's thread to enable this linkage.

### 28.4 Background Process Notifications

The `process` tool's `start` operation accepts a `notifyOnComplete: boolean` parameter. When set, the process exit handler starts a new agent run with the process output (stdout, stderr, exit code) as the message. The run uses `isHeartbeat: true` and the stored `agentID` from the original context.

### 28.5 Batch Parallel Delegation

The `sessions_spawn` tool supports a `tasks` array for parallel subagent execution:

```typescript
tasks?: Array<{ goal: string; agentID?: string }>
concurrency?: number  // Default: 3
```

When `tasks` is provided, subagents are spawned in parallel with a semaphore-based concurrency limiter. All tasks use `waitForResult: true`. Results are aggregated and returned as an array with per-task `threadID`, `runID`, `status`, and `response`.

Both the single-spawn and batch paths share the delegation cap and agent gating used by `agent_message` (§11): `sessions_spawn` refuses to fire when `context.delegationDepth >= 2`, validates that each target `agentID` exists and is `enabled`, and propagates `delegationDepth + 1` into the spawned run so further nesting is bounded. In batch mode, individual tasks routed to invalid agents are marked `status: 'failed'` without launching a run; the remaining tasks proceed.

### 28.6 Cron Script Pre-Processing

Cron jobs support a `script` field containing a shell command that runs before the agent. Its stdout is injected into the agent's message as a `## Script Output` section.

Cron jobs also support `contextFromJobID` for chaining: the referenced job's last run response is injected as a `## Context from job {jobID}` section. The `lastRunID` field tracks each job's most recent run for this purpose.

Script execution is bounded by `CRON_SCRIPT_TIMEOUT_MS` (default 10s). Failures log a warning and proceed without script output.

### 28.7 Plugin Lifecycle Hooks

Plugins can register lifecycle hooks via `PluginContext`:

| Hook             | Called When                | Args                                                                                           |
| ---------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `onPreToolCall`  | Before each tool execution | `{ toolName, args, threadID, runID }`                                                          |
| `onPostToolCall` | After each tool execution  | `{ toolName, args, result, success, durationMs, threadID, runID }`                             |
| `onPreLLMCall`   | Before each model stream   | `{ threadID, runID, provider, modelID, messageCount }`                                         |
| `onPostLLMCall`  | After each model stream    | `{ threadID, runID, provider, modelID, inputTokens, outputTokens, toolCallCount, durationMs }` |
| `onSessionStart` | At run start               | `{ threadID, runID, agentID, userID }`                                                         |
| `onSessionEnd`   | At run end (in finally)    | `{ threadID, runID, agentID, userID }`                                                         |

Hook errors are caught and logged — they never fail the run.

### 28.8 Commitments System

After each non-heartbeat run, the `CommitmentExtractorService` uses an LLM call to identify promises, deadlines, and follow-ups the agent made. Extracted commitments are stored in MongoDB.

The commitment data model is defined in [4.16 Commitment](#416-commitment).

**Delivery:** The heartbeat service queries `CommitmentsService.findDue(agentID)` for pending commitments past their `dueAt` or `reminderAt` and appends them to the heartbeat message as a `## Pending Commitments` section.

**Extraction toggle:** Controlled by `COMMITMENT_EXTRACTION_ENABLED` (default `true`).

---

## 29. Agent Maturity Implementation Plan

This plan tracks the OpenClaw/Hermes comparison work. The goal is to improve correctness and operational safety without replacing SERA's existing NestJS architecture.

### 29.1 Run Reliability

- Runs that exhaust `maxIterations` must always enter a terminal state. If the model has not produced usable final text, the run fails with `max_iterations_exceeded`.
- Tool execution contexts carry an `AbortSignal` so tools can stop promptly when a run is cancelled.
- Model attempts are emitted as structured stream events so clients can see the provider/model used for each attempt and any fallback decision.

### 29.2 Tool Safety

- Workspace path validation uses resolved real paths and `path.relative()` containment checks. Prefix checks are forbidden because `/workspace2` must not be accepted as inside `/workspace`.
- URL validation is DNS-aware and must reject loopback, private, link-local, multicast, and cloud metadata addresses. Redirect targets are validated before a tool follows them. The browser tool validates URLs both before `page.goto` and via a per-page Puppeteer request interceptor so that JavaScript-driven or HTTP-redirect navigations cannot escape into the private network.
- Command validation separates `allow`, `approval_required`, and `block`. Destructive/system-level commands are hard-blocked; mutation and network commands require approval unless explicitly configured otherwise.

### 29.3 Runtime Boundary

- The current AI SDK execution path is exposed through an `AgentRuntime` interface.
- The default implementation is `AiSdkAgentRuntimeService`.
- Future runtimes can implement the same contract for provider-native agents, ACP-like harnesses, or local runtime adapters without expanding the orchestrator.

### 29.4 Model Fallback

- Streaming calls use the configured primary model plus `FALLBACK_MODELS`.
- Retry/fallback decisions use the shared model error classifier.
- Fallback is only attempted before output/tool-call side effects have been emitted. Mid-stream errors fail the current run to avoid duplicated side effects.
- Fallback events include attempt number, provider, model, reason, and whether the fallback was attempted.

### 29.5 Resource-Aware Tool Execution

- Tool metadata may declare resources such as workspace paths, process state, network hosts, or session state.
- Write/process/session resources are serialized by resource key.
- Read-only parallel-safe tools continue to run concurrently.
- Tools without explicit resources preserve the legacy behavior: `parallelSafe: true` runs directly; non-parallel tools use a session-state write lock.

### 29.6 Approvals

- Approval requests use the existing confirmation store as durable state.
- Approval-required tools return a structured result containing the confirmation ID and fingerprint.
- Approval events use the stream event names `approval.requested`, `approval.resolved`, and `approval.expired`.
- Initial enforcement applies to shell execution; plugin and MCP tools can opt into approval through capability metadata.
- Backend wake-up signaling for action-layer waits uses the `ConfirmationSignal` service (Redis Pub/Sub on `sera:confirm:<threadID>:<confirmationID>`). Polling is forbidden in this path. Tool-layer waits do not block — they return `approval_required` and rely on a continuation run to re-evaluate after the user resolves.

### 29.7 Plugin and MCP Capabilities

- Plugins may declare capabilities and permissions in code/config.
- MCP server records may declare per-tool safety metadata.
- MCP tools default to conservative mutation/session locking unless marked read-only and parallel-safe.

### Plugin Permission Enforcement

`PluginContext` methods are gated by the plugin's declared `capabilities.permissions` allowlist. When `permissions` is undefined the plugin retains the legacy "grant all" behavior (backward compatibility with plugins authored before the capability system); once a plugin declares the field, it becomes a strict allowlist:

| Method | Required permission |
| --- | --- |
| `registerTool` | `tools.register` |
| `registerKnowledge` | `knowledge.register` |
| `onPreToolCall`, `onPostToolCall` | `hooks.tools` |
| `onPreLLMCall`, `onPostLLMCall` | `hooks.llm` |
| `onSessionStart`, `onSessionEnd` | _(ungated — lifecycle signals only)_ |

Denied calls are logged at warn level and become no-ops; the plugin continues to load. `network` and `filesystem` are declarative-only — they describe what a plugin claims to need so operators can audit before enabling it, but the runtime does not currently sandbox plugin code, so the host process can't actually deny those accesses from within the plugin's own execution. Promoting them to runtime-enforced would require sandboxing each plugin (separate process, restricted FS, network namespace) — out of scope for this layer. The `tools.register` / `hooks.tools` / `hooks.llm` enforcement above gates what the plugin can register WITH the host; that's the line where runtime enforcement is meaningful.

### Plugin requiresApproval Enforcement

When `capabilities.requiresApproval` is `true`, every tool the plugin registers is wrapped at registration time by `PluginLoaderService.wrapWithApprovalGate`. The wrapper routes each invocation through `ToolApprovalService.requestApproval`, which returns one of three outcomes:

| Verdict | Wrapper behavior |
| --- | --- |
| `pending` | Returns `{ success: false, result: { status: 'approval_required', confirmationID, fingerprint } }`. The agent sees the same approval surface as exec/shell/process tools. `approval.requested` SSE event fires. |
| `approved` | Falls through to the original tool's `execute`. The granted confirmation is removed from `pendingConfirmations` so subsequent identical calls re-prompt. |
| `rejected` | Returns `{ success: false, error: 'Tool "X" rejected by operator: <feedback>' }` and consumes the confirmation. |

The fingerprint is `sha256({ actionName, args })` — deliberately omitting `runID` so a confirmation granted in run A is honored in run B on the same thread (typical flow: the user approves while the agent has already returned `approval_required` and the system spawns a continuation run).

### Tool Approval Flow Correctness

`exec`, `shell`, and `process` use the same `ToolApprovalService` as plugin-wrapped tools. Before this service existed, a granted approval was silently ignored on the next invocation because `requestToolApproval` looked only for `pending` entries — a `status: 'approved'` entry with matching fingerprint produced a new pending alongside the existing approved one, prompting the user again. The current discriminated return shape (`approved` / `pending` / `rejected`) closes that gap.

### 29.8 Test Priorities

- Max-iteration terminal failure.
- Tool cancellation propagation.
- Path prefix and symlink escape rejection.
- DNS and redirect SSRF rejection.
- Command allow/approval/block classification.
- Stream fallback before side effects.
- Resource-lock behavior for conflicting workspace writes.
- Plugin hook failure isolation.
- MCP safety metadata defaults.

### 29.9 Context Management

The full module structure for the context subsystem is documented in §9. The implementation closes gaps that §29.1–29.8 did not enumerate:

- `ContextOrchestrationService` is the only entry point into compression. The orchestrator no longer reaches into a compressor directly.
- `IContextEngine` is the runtime boundary for compression strategies — analogous to `AgentRuntime` from §29.3. The default `CompactingEngine` ships in the same module; alternative engines (DAG, hybrid retrieval) may replace it without touching the orchestrator.
- Token counting is **model-aware**, not provider-aware, and includes flat image cost so multimodal threshold trips are honest.
- Tier 0 lossless pruning (dedup, JSON-safe arg truncation, image pruning) runs before the threshold check on every call. JSON-safe truncation prevents downstream provider 400s on malformed tool-call args.
- Tier 1 summarization runs through `SummarizerService` with an aux-model override path (`AgentConfig.modelOptions.summaryModel` → `SUMMARY_MODEL` env → primary router), iterative merge against a persisted summary, and a structured 13-section template.
- Compaction summaries persist per thread (`context_states`, §4.18) and survive run boundaries. Stale-summary guards bound the iterative chain.
- Secret redaction (`SecretRedactor`) runs before summary input, after summary output, and on `@url:` reference bodies.
- Anti-thrash and cooldown policy (`CompressionPolicy`) prevent pathological compression loops; force bypasses both.
- Compression and reference-expansion state surface through `context.compression.*` and `context.reference.*` SSE events documented in §8.
- `ContextReferencePreprocessor` (§9.11) expands `@file:`/`@diff`/`@staged`/`@url:` references in user messages before they reach the orchestrator. Reuses `PathValidator` and `URLValidator` from §23. Feature-gated by `CONTEXT_REFERENCES_ENABLED`.

---

## Appendix A: Deployment

### Dockerfile

Multi-stage build:

1. **deps** — Install all dependencies (`npm ci`)
2. **builder** — Build TypeScript, prune dev dependencies
3. **production** — Node 24 Alpine, non-root user (`nestjs:1001`), `mkvtoolnix` runtime dependency

### Health Check

```
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1
```

### TypeScript Configuration

- Target: ES2023
- Module: NodeNext
- Strict null checks: enabled
- Decorator metadata: enabled
- Incremental builds: enabled

---

## Appendix B: State Snapshot

The `StateSnapshot` returned by `GET /agent/state/:threadID`:

```typescript
interface StateSnapshot {
  thread: {
    threadID: string;
    toolCalls: ToolCall[];
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  };
  run?: {
    runID: string;
    threadID: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    startedAt: Date;
    completedAt?: Date;
    error?: string;
    response?: string;
    userMessage: string;
    agentID: string;
  };
  agent: {
    custom: Record<string, unknown>;
    currentStep?: string;
    pendingConfirmations: PendingConfirmation[];
  };
}
```

---

## Appendix C: SyncResult

Returned by GitHub sync operations:

```typescript
interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}
```

---

## Appendix D: Test Tooling

The test suite runs on **Vitest** (v3.x) with the **swc** transform via `unplugin-swc`.

### Why swc

NestJS depends on `experimentalDecorators` + `emitDecoratorMetadata` to wire dependency injection and Mongoose `@Prop()` types. swc is configured with `legacyDecorator: true`, `decoratorMetadata: true`, and `keepClassNames: true` to preserve this contract.

### Target Alignment

swc compiles spec files to `es2022` (its maximum stable target). The runtime build (`nest build` via `ts-loader`) targets `ES2023` per `tsconfig.json`. No ES2023-only language features are used in spec files, so the target gap is inert.

### Union-Type `@Prop()` Pattern

For schema fields with union-of-string-literals types (e.g., `kind: 'image' | 'file'`), `@Prop()` MUST declare an explicit `type: String`. swc's `decoratorMetadata` emits `Object` for unions where TypeScript emits `String`; `@nestjs/mongoose` rejects the ambiguous metadata. Examples in `attachment.schema.ts` and `scheduled-execution.schema.ts`. This pattern is also the NestJS-recommended approach for enum fields and is more robust than relying on reflection of the literal-union type.

### Scripts

| Script               | Behavior                            |
| -------------------- | ----------------------------------- |
| `npm test`           | Single-pass run (CI mode)           |
| `npm run test:watch` | Watch mode                          |
| `npm run test:cov`   | Single-pass run with v8 coverage    |

### Coverage

Provider: `v8`. Reports written to `./coverage`. Excludes `*.module.ts`, `*.dto.ts`, `*.schema.ts`, `*.interface.ts`, `*.interfaces.ts`, `main.ts`, and spec files themselves.

### ESLint

The base config disallows `@typescript-eslint/no-unsafe-*`. A `**/*.spec.ts` override turns these off, since test mocks have inherently loose types.
