import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Validate and sandbox file paths to a workspace directory.
 * Prevents directory traversal and access to sensitive files.
 */

const BLOCKED_PATTERNS = [
  /\.env/i,
  /\.git\//,
  /\.git$/,
  /node_modules\//,
  /\.ssh\//,
  /\.aws\//,
  /\.docker\//,
  /id_rsa/,
  /\.pem$/,
  /credentials/i,
  /secrets?\./i,
];

export interface PathValidationResult {
  valid: boolean;
  resolvedPath?: string;
  error?: string;
}

export function validatePath(
  inputPath: string,
  workspaceDir: string,
): PathValidationResult {
  if (!inputPath || !workspaceDir) {
    return { valid: false, error: 'Path and workspace directory are required' };
  }

  // Resolve relative to workspace
  const resolved = path.resolve(workspaceDir, inputPath);

  // Prevent traversal outside workspace
  if (!resolved.startsWith(path.resolve(workspaceDir))) {
    return {
      valid: false,
      error: 'Path traversal outside workspace is not allowed',
    };
  }

  // Check blocked patterns
  const relative = path.relative(workspaceDir, resolved);
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(relative) || pattern.test(path.basename(resolved))) {
      return {
        valid: false,
        error: `Access to "${relative}" is blocked for security`,
      };
    }
  }

  return { valid: true, resolvedPath: resolved };
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
