import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export function resolveWorkspace(
  _context: ToolExecutionContext,
  fallback: string,
): string {
  return fallback;
}

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
