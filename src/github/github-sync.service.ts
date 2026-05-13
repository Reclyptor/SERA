import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import * as yaml from 'js-yaml';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { PromptDocument } from '../prompts/prompt.schema';
import type { SkillDocument } from '../agent/skills/skill.schema';

interface TreeEntry {
  path: string;
  sha: string;
  type: 'blob' | 'tree';
  size?: number;
}

interface GitHubFile {
  content: string;
  sha: string;
  path: string;
}

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

const SYNC_SHA_PREFIX = 'github:sync:';
const API_BASE = 'https://api.github.com';

@Injectable()
export class GitHubSyncService {
  private readonly logger = new Logger(GitHubSyncService.name);
  private readonly pat: string | null;
  readonly promptsRepo: string;
  readonly skillsRepo: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.pat = this.configService.get<string>('GITHUB_PAT') ?? null;
    this.promptsRepo = this.configService.get<string>(
      'GITHUB_PROMPTS_REPO',
      'Reclyptor/Prompts',
    );
    this.skillsRepo = this.configService.get<string>(
      'GITHUB_SKILLS_REPO',
      'Reclyptor/Skills',
    );

    if (!this.pat) {
      this.logger.warn('GITHUB_PAT not set — GitHub sync disabled');
    }
  }

  get enabled(): boolean {
    return this.pat !== null;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.pat}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  // ── Tree & File Operations ──────────────────────────────────────────

  async fetchTree(repo: string, branch = 'master'): Promise<TreeEntry[]> {
    const res = await fetch(
      `${API_BASE}/repos/${repo}/git/trees/${branch}?recursive=1`,
      {
        headers: this.headers,
      },
    );
    if (!res.ok)
      throw new Error(
        `GitHub tree fetch failed: ${res.status} ${res.statusText}`,
      );

    const data = await res.json();
    return (data.tree as TreeEntry[]).filter((e) => e.type === 'blob');
  }

  async fetchFile(repo: string, path: string): Promise<GitHubFile> {
    const res = await fetch(
      `${API_BASE}/repos/${repo}/contents/${encodeURIComponent(path)}`,
      {
        headers: this.headers,
      },
    );
    if (!res.ok)
      throw new Error(`GitHub file fetch failed (${path}): ${res.status}`);

    const data = await res.json();
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return { content, sha: data.sha, path: data.path };
  }

  async putFile(
    repo: string,
    path: string,
    content: string,
    sha?: string,
    message?: string,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      message: message ?? `Update ${path}`,
      content: Buffer.from(content).toString('base64'),
    };
    if (sha) body.sha = sha;

    const res = await fetch(
      `${API_BASE}/repos/${repo}/contents/${encodeURIComponent(path)}`,
      {
        method: 'PUT',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (res.status === 409 && sha) {
      // SHA conflict — refetch and retry once
      const current = await this.fetchFile(repo, path);
      return this.putFile(repo, path, content, current.sha, message);
    }

    if (!res.ok)
      throw new Error(`GitHub putFile failed (${path}): ${res.status}`);

    const data = await res.json();
    return data.content.sha;
  }

  async deleteFile(
    repo: string,
    path: string,
    sha: string,
    message?: string,
  ): Promise<void> {
    const res = await fetch(
      `${API_BASE}/repos/${repo}/contents/${encodeURIComponent(path)}`,
      {
        method: 'DELETE',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message ?? `Delete ${path}`,
          sha,
        }),
      },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`GitHub deleteFile failed (${path}): ${res.status}`);
    }
  }

  // ── SHA Tracking ────────────────────────────────────────────────────

  private async getStoredSha(repo: string): Promise<string | null> {
    try {
      return await this.redis.get(`${SYNC_SHA_PREFIX}${repo}:sha`);
    } catch {
      return null;
    }
  }

  private async setStoredSha(repo: string, sha: string): Promise<void> {
    try {
      await this.redis.set(`${SYNC_SHA_PREFIX}${repo}:sha`, sha);
    } catch {
      this.logger.warn('Failed to store sync SHA in Redis');
    }
  }

  private async getHeadSha(repo: string, branch = 'master'): Promise<string> {
    const res = await fetch(`${API_BASE}/repos/${repo}/commits/${branch}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`GitHub HEAD fetch failed: ${res.status}`);
    const data = await res.json();
    return data.sha;
  }

  // ── Prompt Sync ─────────────────────────────────────────────────────

  async syncPrompts(promptModel: Model<PromptDocument>): Promise<SyncResult> {
    if (!this.enabled)
      return { created: 0, updated: 0, unchanged: 0, errors: [] };

    const result: SyncResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: [],
    };

    try {
      const headSha = await this.getHeadSha(this.promptsRepo);
      const storedSha = await this.getStoredSha(this.promptsRepo);

      if (headSha === storedSha) {
        this.logger.debug('Prompts repo unchanged, skipping sync');
        return result;
      }

      const tree = await this.fetchTree(this.promptsRepo);
      const mdFiles = tree.filter(
        (e) => e.path.endsWith('.md') && !e.path.includes('/'),
      );

      for (const entry of mdFiles) {
        const slug = entry.path.replace(/\.md$/, '');

        try {
          const existing = await promptModel.findOne({ slug }).exec();

          if (existing && existing.seedHash === entry.sha) {
            result.unchanged++;
            continue;
          }

          const file = await this.fetchFile(this.promptsRepo, entry.path);
          const { meta, content } = this.parseFrontmatter(file.content);

          const update: Record<string, unknown> = {
            content,
            seedHash: entry.sha,
          };
          if (meta.description) update.description = meta.description;
          if (meta.extends) update.extends = meta.extends;
          if (meta.metadata) update.metadata = meta.metadata;

          if (existing) {
            await promptModel.updateOne({ slug }, { $set: update });
            result.updated++;
            this.logger.log(`Updated prompt "${slug}" from GitHub`);
          } else {
            await promptModel.create({ slug, ...update });
            result.created++;
            this.logger.log(`Created prompt "${slug}" from GitHub`);
          }
        } catch (err) {
          const msg = `Failed to sync prompt "${slug}": ${err instanceof Error ? err.message : err}`;
          result.errors.push(msg);
          this.logger.error(msg);
        }
      }

      await this.setStoredSha(this.promptsRepo, headSha);
      this.logger.log(
        `Prompts sync complete: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`,
      );
    } catch (err) {
      const msg = `Prompts sync failed: ${err instanceof Error ? err.message : err}`;
      result.errors.push(msg);
      this.logger.error(msg);
    }

    return result;
  }

  // ── Skill Sync ──────────────────────────────────────────────────────

  async syncSkills(skillModel: Model<SkillDocument>): Promise<SyncResult> {
    if (!this.enabled)
      return { created: 0, updated: 0, unchanged: 0, errors: [] };

    const result: SyncResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: [],
    };

    try {
      const headSha = await this.getHeadSha(this.skillsRepo);
      const storedSha = await this.getStoredSha(this.skillsRepo);

      if (headSha === storedSha) {
        this.logger.debug('Skills repo unchanged, skipping sync');
        return result;
      }

      const tree = await this.fetchTree(this.skillsRepo);

      // Group files by top-level directory
      const skillDirs = new Map<string, TreeEntry[]>();
      for (const entry of tree) {
        const slashIdx = entry.path.indexOf('/');
        if (slashIdx === -1) continue; // skip root-level files
        const dirName = entry.path.slice(0, slashIdx);
        if (!skillDirs.has(dirName)) skillDirs.set(dirName, []);
        skillDirs.get(dirName)!.push(entry);
      }

      for (const [name, entries] of skillDirs) {
        const skillMd = entries.find((e) => e.path === `${name}/SKILL.md`);
        if (!skillMd) continue;

        try {
          // Composite hash from all file SHAs in the directory
          const compositeSha = this.computeCompositeSha(entries);
          const existing = await skillModel.findOne({ name }).exec();

          if (existing && existing.seedHash === compositeSha) {
            result.unchanged++;
            continue;
          }

          const file = await this.fetchFile(this.skillsRepo, skillMd.path);
          const { meta, content } = this.parseSkillFrontmatter(file.content);

          // Fetch supplementary files
          const supplementary: { path: string; content: string }[] = [];
          for (const entry of entries) {
            if (entry.path === `${name}/SKILL.md`) continue;
            const relPath = entry.path.slice(name.length + 1);
            const fetched = await this.fetchFile(this.skillsRepo, entry.path);
            supplementary.push({ path: relPath, content: fetched.content });
          }

          const update: Record<string, unknown> = {
            description: meta.description ?? `Synced from ${name}/SKILL.md`,
            content,
            seedHash: compositeSha,
            files: supplementary,
          };
          if (meta.license) update.license = meta.license;
          if (meta.compatibility) update.compatibility = meta.compatibility;
          if (meta.allowedTools) update.allowedTools = meta.allowedTools;
          if (meta.metadata) update.metadata = meta.metadata;

          if (existing) {
            await skillModel.updateOne({ name }, { $set: update });
            result.updated++;
            this.logger.log(`Updated skill "${name}" from GitHub`);
          } else {
            await skillModel.create({ name, ...update });
            result.created++;
            this.logger.log(`Created skill "${name}" from GitHub`);
          }
        } catch (err) {
          const msg = `Failed to sync skill "${name}": ${err instanceof Error ? err.message : err}`;
          result.errors.push(msg);
          this.logger.error(msg);
        }
      }

      await this.setStoredSha(this.skillsRepo, headSha);
      this.logger.log(
        `Skills sync complete: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`,
      );
    } catch (err) {
      const msg = `Skills sync failed: ${err instanceof Error ? err.message : err}`;
      result.errors.push(msg);
      this.logger.error(msg);
    }

    return result;
  }

  // ── Push to GitHub ──────────────────────────────────────────────────

  async pushPrompt(
    slug: string,
    data: {
      content: string;
      extends?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<string | null> {
    if (!this.enabled) return null;

    try {
      const fileContent = this.serializePromptFile(data);
      const existing = await this.fetchFile(
        this.promptsRepo,
        `${slug}.md`,
      ).catch(() => null);
      const newSha = await this.putFile(
        this.promptsRepo,
        `${slug}.md`,
        fileContent,
        existing?.sha,
        `Update prompt: ${slug}`,
      );
      return newSha;
    } catch (err) {
      this.logger.warn(`Failed to push prompt "${slug}" to GitHub:`, err);
      return null;
    }
  }

  async pushSkill(
    name: string,
    data: {
      content: string;
      description?: string;
      license?: string;
      compatibility?: string;
      allowedTools?: string[];
      metadata?: Record<string, string>;
      files?: { path: string; content: string }[];
    },
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const skillMdContent = this.serializeSkillFile(data);
      const existing = await this.fetchFile(
        this.skillsRepo,
        `${name}/SKILL.md`,
      ).catch(() => null);
      await this.putFile(
        this.skillsRepo,
        `${name}/SKILL.md`,
        skillMdContent,
        existing?.sha,
        `Update skill: ${name}`,
      );

      if (data.files) {
        for (const file of data.files) {
          const filePath = `${name}/${file.path}`;
          const existingFile = await this.fetchFile(
            this.skillsRepo,
            filePath,
          ).catch(() => null);
          await this.putFile(
            this.skillsRepo,
            filePath,
            file.content,
            existingFile?.sha,
            `Update ${name}/${file.path}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to push skill "${name}" to GitHub:`, err);
    }
  }

  async deletePromptFile(slug: string): Promise<void> {
    if (!this.enabled) return;

    try {
      const existing = await this.fetchFile(this.promptsRepo, `${slug}.md`);
      await this.deleteFile(
        this.promptsRepo,
        `${slug}.md`,
        existing.sha,
        `Delete prompt: ${slug}`,
      );
    } catch (err) {
      this.logger.warn(`Failed to delete prompt "${slug}" from GitHub:`, err);
    }
  }

  async deleteSkillFiles(name: string): Promise<void> {
    if (!this.enabled) return;

    try {
      const tree = await this.fetchTree(this.skillsRepo);
      const skillFiles = tree.filter((e) => e.path.startsWith(`${name}/`));

      for (const entry of skillFiles) {
        await this.deleteFile(
          this.skillsRepo,
          entry.path,
          entry.sha,
          `Delete skill: ${name}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to delete skill "${name}" from GitHub:`, err);
    }
  }

  // ── Serialization ───────────────────────────────────────────────────

  private serializePromptFile(data: {
    content: string;
    extends?: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }): string {
    const fm: Record<string, unknown> = {};
    if (data.description) fm.description = data.description;
    if (data.extends) fm.extends = data.extends;
    if (data.metadata && Object.keys(data.metadata).length > 0)
      fm.metadata = data.metadata;

    if (Object.keys(fm).length === 0) return data.content;

    const fmStr = yaml.dump(fm, { lineWidth: -1 }).trimEnd();
    return `---\n${fmStr}\n---\n\n${data.content}`;
  }

  private serializeSkillFile(data: {
    content: string;
    description?: string;
    license?: string;
    compatibility?: string;
    allowedTools?: string[];
    metadata?: Record<string, string>;
  }): string {
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

  // ── Frontmatter Parsing ─────────────────────────────────────────────

  private parseFrontmatter(raw: string): {
    meta: Record<string, any>;
    content: string;
  } {
    if (!raw.startsWith('---')) return { meta: {}, content: raw };

    const endIndex = raw.indexOf('---', 3);
    if (endIndex === -1) return { meta: {}, content: raw };

    const frontmatter = raw.slice(3, endIndex).trim();
    const content = raw.slice(endIndex + 3).trim();

    try {
      const parsed = yaml.load(frontmatter) as Record<string, any>;
      if (!parsed || typeof parsed !== 'object') return { meta: {}, content };
      return { meta: parsed, content };
    } catch {
      return { meta: {}, content: raw };
    }
  }

  private parseSkillFrontmatter(raw: string): {
    meta: Record<string, any>;
    content: string;
  } {
    const { meta, content } = this.parseFrontmatter(raw);

    if (meta['allowed-tools']) {
      meta.allowedTools = (meta['allowed-tools'] as string).split(/\s+/);
      delete meta['allowed-tools'];
    }

    return { meta, content };
  }

  private computeCompositeSha(entries: TreeEntry[]): string {
    const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
    const input = sorted.map((e) => `${e.path}:${e.sha}`).join('\0');
    return createHash('sha256').update(input).digest('hex');
  }
}
