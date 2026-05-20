import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';

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

  let workspaceReal: string;
  try {
    workspaceReal = fsSync.realpathSync.native(path.resolve(workspaceDir));
  } catch {
    return { valid: false, error: 'Workspace directory does not exist' };
  }

  const requested = path.resolve(workspaceReal, inputPath);
  const resolved = resolveRealOrNearest(requested);
  const relativeToWorkspace = path.relative(workspaceReal, resolved);

  if (
    relativeToWorkspace === '..' ||
    relativeToWorkspace.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToWorkspace)
  ) {
    return {
      valid: false,
      error: 'Path traversal outside workspace is not allowed',
    };
  }

  const relative = path.relative(workspaceReal, resolved);
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

function resolveRealOrNearest(targetPath: string): string {
  try {
    return fsSync.realpathSync.native(targetPath);
  } catch {
    const parts = targetPath.split(path.sep).filter(Boolean);
    const root = path.parse(targetPath).root;
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = path.join(root, ...parts.slice(0, i));
      try {
        const realParent = fsSync.realpathSync.native(candidate || root);
        return path.join(realParent, ...parts.slice(i));
      } catch {
        // Continue walking toward the filesystem root.
      }
    }
    return targetPath;
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
