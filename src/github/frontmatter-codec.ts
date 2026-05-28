import { createHash } from 'crypto';
import * as yaml from 'js-yaml';

export interface ParsedFrontmatter {
  meta: Record<string, unknown>;
  content: string;
}

export interface PromptFrontmatterData {
  content: string;
  extends?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SkillFrontmatterData {
  content: string;
  description?: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
  metadata?: Record<string, unknown>;
}

export interface ShaTreeEntry {
  path: string;
  sha: string;
}

/**
 * Parses a `---\n…\n---\n` YAML frontmatter block from a markdown
 * payload. Returns the parsed meta object plus the post-frontmatter
 * content. If the payload has no frontmatter or the YAML is malformed,
 * meta is `{}` and content is the original raw text.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  if (!raw.startsWith('---')) return { meta: {}, content: raw };

  const endIndex = raw.indexOf('---', 3);
  if (endIndex === -1) return { meta: {}, content: raw };

  const frontmatter = raw.slice(3, endIndex).trim();
  const content = raw.slice(endIndex + 3).trim();

  try {
    const parsed = yaml.load(frontmatter) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return { meta: {}, content };
    return { meta: parsed, content };
  } catch {
    return { meta: {}, content: raw };
  }
}

/**
 * Skill-specific variant that additionally maps the
 * `allowed-tools: "tool1 tool2"` frontmatter key into the
 * `allowedTools: string[]` field used by the Skill schema.
 */
export function parseSkillFrontmatter(raw: string): ParsedFrontmatter {
  const { meta, content } = parseFrontmatter(raw);

  if (meta['allowed-tools']) {
    meta.allowedTools = (meta['allowed-tools'] as string).split(/\s+/);
    delete meta['allowed-tools'];
  }

  return { meta, content };
}

export function serializePromptFile(data: PromptFrontmatterData): string {
  const fm: Record<string, unknown> = {};
  if (data.description) fm.description = data.description;
  if (data.extends) fm.extends = data.extends;
  if (data.metadata && Object.keys(data.metadata).length > 0)
    fm.metadata = data.metadata;

  if (Object.keys(fm).length === 0) return data.content;

  const fmStr = yaml.dump(fm, { lineWidth: -1 }).trimEnd();
  return `---\n${fmStr}\n---\n\n${data.content}`;
}

export function serializeSkillFile(data: SkillFrontmatterData): string {
  const fm: Record<string, unknown> = {};
  if (data.description) fm.description = data.description;
  if (data.license) fm.license = data.license;
  if (data.compatibility) fm.compatibility = data.compatibility;
  if (data.allowedTools?.length)
    fm['allowed-tools'] = data.allowedTools.join(' ');
  if (data.metadata && Object.keys(data.metadata).length > 0)
    fm.metadata = data.metadata;

  const fmStr = yaml.dump(fm, { lineWidth: -1 }).trimEnd();
  return `---\n${fmStr}\n---\n\n${data.content}`;
}

/**
 * Stable hash across a set of `(path, sha)` pairs. Used by skill sync
 * to detect changes in any file within a skill directory, since GitHub
 * itself only commits per-file shas. Sorted by path so the hash is
 * deterministic regardless of how the directory tree iterates.
 */
export function computeCompositeSha(entries: ShaTreeEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const input = sorted.map((e) => `${e.path}:${e.sha}`).join('\0');
  return createHash('sha256').update(input).digest('hex');
}
