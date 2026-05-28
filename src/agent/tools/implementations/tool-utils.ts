import type { ToolExecutionResult } from '../tool.interface';

export function truncateOutput(content: string, maxSize: number): string {
  if (content.length <= maxSize) return content;
  return content.slice(0, maxSize) + '\n[...truncated]';
}

export function disabledError(
  feature: string,
  envVar: string,
): ToolExecutionResult {
  return {
    success: false,
    error: `${feature} is disabled. Set ${envVar}=true to enable.`,
  };
}

// Variables passed to runtime tools (exec/shell/process/code_execution).
// Mirrors the sandbox env allowlist in SPEC §23 so non-sandbox executions
// do not leak AUTH_SECRET, provider API keys, NTFY tokens, the Mongo URI,
// or any other secret in process.env into user-supplied scripts.
const ALLOWED_RUNTIME_ENV_VARS = ['HOME', 'PATH', 'TMPDIR', 'LANG'] as const;

export function buildToolEnv(
  extraVars?: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_RUNTIME_ENV_VARS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (extraVars) {
    for (const [k, v] of Object.entries(extraVars)) {
      if (v !== undefined) env[k] = v;
    }
  }
  return env;
}
