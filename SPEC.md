# SERA Application Specification

> **Version:** 1.0
> **Last Updated:** 2026-05-14
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
9. [Context Compression](#9-context-compression)
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
29. [Appendix A: Deployment](#appendix-a-deployment)
30. [Appendix B: State Snapshot](#appendix-b-state-snapshot)
31. [Appendix C: SyncResult](#appendix-c-syncresult)

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

| Variable                | Description                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| `AUTH_SECRET`           | Secret for decrypting Auth.js session cookies                                  |
| `ANTHROPIC_API_KEY`     | Anthropic API key (or first key in pool)                                       |
| `PRIMARY_MODEL`         | Default model in `provider/model` format (e.g., `anthropic/claude-sonnet-4-6`) |
| `CORS_ORIGIN`           | Allowed CORS origin                                                            |
| `AUTHENTIK_ISSUER`      | OIDC issuer URL for token validation                                           |
| `AUTHENTIK_CLIENT_ID`   | OIDC client ID for audience validation                                         |
| `MONGODB_URI`           | MongoDB connection string                                                      |
| `OPENAI_API_KEY`        | OpenAI API key (or first key in pool)                                          |
| `OBJECT_STORAGE_BUCKET` | S3-compatible bucket for durable attachments                                   |
| `REDIS_URL`             | Redis connection URL                                                           |
| `WEBHOOK_API_KEY`       | Shared API key required by webhook ingress                                     |

### Optional Variables

| Variable                           | Default                                       | Description                                                                   |
| ---------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| `PORT`                             | `3001`                                        | Server listen port                                                            |
| `FALLBACK_MODELS`                  | _(none)_                                      | Comma-separated fallback models in `provider/model` format                    |
| `OBJECT_STORAGE_ENDPOINT`          | _(AWS SDK default)_                           | S3-compatible endpoint; set for MinIO, omit for AWS S3                        |
| `OBJECT_STORAGE_REGION`            | `us-east-1`                                   | S3-compatible region                                                          |
| `OBJECT_STORAGE_ACCESS_KEY_ID`     | _(AWS SDK default)_                           | Explicit object storage access key; omit to use the SDK credential chain      |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | _(AWS SDK default)_                           | Explicit object storage secret key; omit to use the SDK credential chain      |
| `OBJECT_STORAGE_FORCE_PATH_STYLE`  | `false`                                       | Set `true` for MinIO/path-style S3 endpoints                                  |
| `OBJECT_STORAGE_PREFIX`            | `attachments`                                 | Object key prefix for uploaded attachments                                    |
| `OBJECT_STORAGE_MAX_UPLOAD_BYTES`  | `26214400`                                    | Max multipart attachment size, default 25 MiB                                 |
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
| `CRON_SCRIPT_TIMEOUT_MS`           | `10000`                                       | Max execution time (ms) for cron job pre-processing scripts                   |
| `COMMITMENT_EXTRACTION_ENABLED`    | `true`                                        | Toggle LLM-based commitment extraction after runs                             |

### Redis Key Namespace

| Pattern                    | Type    | TTL                         | Purpose                    |
| -------------------------- | ------- | --------------------------- | -------------------------- |
| `prompt:{slug}`            | String  | 300s                        | Cached prompt content      |
| `skill:{name}`             | String  | 300s                        | Cached skill document      |
| `skill:{name}:file:{path}` | String  | 300s                        | Cached skill file          |
| `github:sync:{repo}`       | String  | None                        | Last synced commit SHA     |
| `run:{runID}:stream`       | Stream  | 1800s (300s after complete) | SSE event stream           |
| `chat:{chatID}:activeRun`  | String  | 1800s                       | Active run tracking (JSON) |
| `image:{id}`               | String  | 3600s                       | Temporary image storage    |
| `cancel:{runID}`           | Pub/Sub | N/A                         | Run cancellation channel   |

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
| `messages`  | Message[] | No       | `[]`    | Text index on `messages.content`        |
| `createdAt` | Date      | (auto)   |         |                                         |
| `updatedAt` | Date      | (auto)   |         |                                         |

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

### 4.13 UsageRecord

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

### 4.14 PluginConfigRecord

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

### 4.15 McpServer

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

### 4.16 Commitment

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

---

## 6. Orchestration Engine

The orchestrator is the core execution loop that processes user messages through LLM inference with tool use.

### Execution Flow

```
POST /agent/chat
  |
  v
[Resolve Agent] -- AgentRouterService.resolve(context)
  |                 Priority: user binding > channel binding > default binding
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

The `ModelRouterService` manages multiple LLM providers with automatic failover, credential pooling, and prompt caching.

### Providers

| Provider  | Priority | Default Model       | Allowed Models                                             | Thinking                                                   |
| --------- | -------- | ------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Anthropic | 1        | `claude-sonnet-4-6` | `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-7` | Adaptive (opus-4/sonnet-4-6/sonnet-4-5), Budgeted (others) |
| OpenAI    | 2        | `gpt-4o`            | `gpt-4o-mini`, `gpt-4o`, `o3`                              | No                                                         |
| Google    | 3        | `gemini-2.0-flash`  | `gemini-2.0-flash`                                         | No                                                         |
| vLLM      | 4        | `Qwen3.6-27B-FP8`   | `Qwen3.6-27B-FP8`, `Huihui-Qwen3.6-27B-abliterated`        | No                                                         |

All model references in `PRIMARY_MODEL`, `FALLBACK_MODELS`, and `preferredModel` use `provider/model` format (e.g., `anthropic/claude-sonnet-4-6`). The router parses this to find the correct provider entry.

### Model Resolution Order

1. Preferred model (if specified and provider not excluded)
2. Preferred provider (if specified and not excluded)
3. Primary model (from `PRIMARY_MODEL` env var)
4. Fallback models (from `FALLBACK_MODELS` env var, in order)
5. First available provider (by priority)

### Retry & Failover

**`generate()` method:**

- 3 attempts with exponential backoff (capped at 30s) plus jitter
- On context length errors: thrown immediately (triggers compression)
- On retryable non-rotate errors (500, 504, request timeout, connection reset): retry with backoff
- On rotate-required errors (rate limit, quota, invalid auth, model not found, service unavailable): cooldown the provider key, exclude provider, try next
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

## 9. Context Compression

The `ContextCompressorService` manages conversation length to stay within provider context windows.

### Compression Tiers

| Tier              | Trigger                     | Behavior                                                                       |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------ |
| **0 - None**      | Under 75% of context window | No compression                                                                 |
| **1 - Prune**     | Over threshold              | Replaces tool outputs >2000 chars with `[Pruned: {size} chars, {lines} lines]` |
| **2 - Summarize** | Pruning insufficient        | LLM-powered structured summarization of middle turns                           |

### Summarization Strategy

- **Head** (protected): First 2 messages are always kept intact
- **Tail** (protected): Most recent messages up to 30,000 tokens
- **Middle**: Everything between head and tail is summarized

The summarizer sends middle messages to the LLM with a structured prompt (loaded from `summary` slug if available). The summary is injected as a system message prefixed with `[CONTEXT SUMMARY]`, followed by an acknowledgment message.

### Token Counting

Uses `js-tiktoken` with provider-specific encoders:

- Anthropic, vLLM: `cl100k_base`
- OpenAI, Google: `o200k_base`
- Per-message overhead: 4 tokens

### Context Windows

| Provider  | Default Size |
| --------- | ------------ |
| Anthropic | 200,000      |
| OpenAI    | 128,000      |
| Google    | 1,000,000    |
| vLLM      | 131,072      |

---

## 10. Tool System

### Tool Interface

```typescript
interface Tool<TParams extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: TParams; // Zod schema
  parallelSafe?: boolean; // Default: false
  execute(
    args: z.infer<TParams>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
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

### Registered Tools (32 core + MCP)

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
| `process`        | `operation` (start/list/output/kill), `command?`, `processID?`, `notifyOnComplete?` | No       | Background process management. Auto-cleanup after 5 min. Max 64KB output per stream.     |
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
| `sessions_send`    | `targetChatID`, `content`, `role?`                                                                           | No       | Append message to target chat.                        |
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

#### MCP Tools

MCP tools are registered asynchronously 2 seconds after bootstrap. Each MCP tool is adapted from MCP protocol definitions to the SERA `Tool` interface. Tool names are prefixed with `mcp_{serverName}_`. All MCP tools are `parallelSafe: true`.

---

## 11. Agent Configuration

### Multi-Agent Architecture

SERA supports multiple named agents, each with its own configuration, tool policy, model preferences, and messaging policy. A routing system determines which agent handles each request.

### Default Agent

On first boot, `AgentsBootstrapService` seeds:

- Agent: `agentID: 'default'`, `name: 'SERA'`, `description: 'Default agent — handles all unrouted requests'`
- Binding: `bindingType: 'default'`

### Agent Routing

`AgentRouterService.resolve(context)` determines the agent for a request:

1. **User binding** — `bindingType: 'user'`, `bindingValue` matches `userID`
2. **Channel binding** — `bindingType: 'channel'`, `bindingValue` matches `chatID` or `threadID`
3. **Default binding** — `bindingType: 'default'`
4. **null** — No agent matched

All lookups filter by `enabled: true` and sort by `priority` descending (highest priority wins).

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

| Action                 | Parameters                                                   | Confirmation | Description                          |
| ---------------------- | ------------------------------------------------------------ | ------------ | ------------------------------------ |
| `save_memory`          | `content`, `tags?`                                           | No           | Save fact to long-term memory        |
| `search_memory`        | `query`, `limit?`                                            | No           | Search long-term memory              |
| `delete_memory`        | `memoryID`                                                   | Yes          | Delete a specific memory             |
| `send_notification`    | `title`, `message`, `level?` (info/warning/error/success)    | No           | Send notification to frontend        |
| `request_confirmation` | `message`, `actionName`, `actionArgs?`, `timeoutMs?` (5 min) | No           | Pause run and wait for user approval |

### Confirmation Flow

1. Action calls `request_confirmation`
2. `StateService.addPendingConfirmation()` creates a pending confirmation
3. `confirmation.required` SSE event is emitted
4. Action polls every 1 second for resolution
5. User calls `POST /agent/confirm/:threadID/:confirmationID`
6. `StateService.resolveConfirmation()` updates status
7. `confirmation.resolved` SSE event is emitted
8. Action returns with decision (`approved` / `timed_out`)

---

## 13. Memory System

### Backend

User memories are stored via the **Mem0 OSS** library (`mem0ai/oss`) with:

- **Vector Store:** Qdrant (collection: `mem0_memories`)
- **Embeddings:** OpenAI (`text-embedding-3-small` or configured model, dimensions: 1536 default, 3072 for `text-embedding-3-large`)
- **LLM for extraction:** Anthropic (`claude-haiku-4-5`)
- **History:** Disabled (`disableHistory: true`)

### Operations

| Method                                      | Description                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `add(userID, content, options?)`            | Store a memory with optional tags and metadata (`infer: false` — stores verbatim)                                         |
| `search(userID, query, limit?, threshold?)` | Semantic search (default threshold: 0.7)                                                                                  |
| `getAll(userID)`                            | Retrieve all memories, sorted by createdAt desc                                                                           |
| `getByTags(userID, tags)`                   | Filter memories containing all specified tags                                                                             |
| `delete(userID, memoryID)`                  | Delete single memory                                                                                                      |
| `extractAndStore(userID, conversation)`     | Use Mem0 inference (`infer: true`) to extract facts from conversation. Tags auto-extracted entries with `auto-extracted`. |
| `getContextForQuery(userID, query)`         | Search with limit 5, threshold 0.6. Formats as `Relevant information about this user:\n- memory1\n- memory2`              |

### Automatic Memory Extraction

After each completed run (unless it's a heartbeat run), the orchestrator calls `extractAndStore()` with the conversation, allowing Mem0 to automatically identify and store important facts.

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
  registerKnowledge(key: string, content: string): void;
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
- Finds jobs where `nextRunAt <= now` (or `nextRunAt` is null)
- Executes each job's `command` as an agent goal (maxSteps: 10, maxIterations: 2)
- Updates `lastRunAt` and computes new `nextRunAt` via `cron-parser`
- Fallback `nextRunAt`: now + 30 minutes (if cron parsing fails)

---

## 21. Heartbeat System

Heartbeats are periodic background agent runs for autonomous monitoring.

### Configuration

Each agent can have one heartbeat configuration specifying interval, active hours, checklist, and token limits.

### Execution

- `HeartbeatService` ticks every 60 seconds
- Finds configs where `nextRunAt <= now` (or null) and `enabled: true`
- Filters by `activeHours` (supports midnight wrap, timezone-aware via `Intl.DateTimeFormat`)
- Builds message from `heartbeat` prompt slug or default template
- Executes as agent goal with `isHeartbeat: true` (maxSteps: 10, maxIterations: 2)
- Heartbeat runs skip memory extraction on completion

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

Cost is calculated as: `(inputTokens + thinkingTokens) * inputRate + outputTokens * outputRate + cacheReadTokens * cacheReadRate + cacheWriteTokens * cacheWriteRate`. Result is rounded to 2 decimal places (cents).

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
| Key format     | `{OBJECT_STORAGE_PREFIX}/{safeUserID}/{attachmentID}`                  |
| Metadata store | MongoDB `attachments` collection                                       |
| Access         | Private bucket; clients access bytes through authenticated SERA routes |

The upload endpoint (`POST /agent/attachments`) accepts a multipart `file` field. SERA detects `kind` from the MIME type (`image/*` => `image`, otherwise `file`) and returns an `Attachment` summary. Chat requests send `attachmentIDs` separately from `message`; text is never overloaded with attachment markers.

During orchestration, `AttachmentMessageResolverService` fetches object bytes from storage and converts message attachments into AI SDK content parts:

- `image` attachments become `{ type: 'image', image: Buffer, mediaType }`.
- `file` attachments become `{ type: 'file', data: Buffer, mediaType, filename }`.

### Upload Constraints

- Max file size: `OBJECT_STORAGE_MAX_UPLOAD_BYTES` (default 25 MiB)
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
