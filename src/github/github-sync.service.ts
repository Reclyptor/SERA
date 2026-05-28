import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import type { PromptDocument } from '../prompts/prompt.schema';
import type { SkillDocument } from '../agent/skills/skill.schema';
import {
  parseFrontmatter,
  parseSkillFrontmatter,
  serializePromptFile,
  serializeSkillFile,
  computeCompositeSha,
  type PromptFrontmatterData,
  type SkillFrontmatterData,
} from './frontmatter-codec';
import { GitHubHttpClient } from './github-http-client.service';
import { GitHubShaTracker } from './github-sha-tracker.service';

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

/**
 * Coordinates bidirectional GitHub sync for prompts and skills.
 * Delegates HTTP I/O to `GitHubHttpClient`, last-synced commit tracking
 * to `GitHubShaTracker`, and frontmatter parsing/serialization to the
 * `frontmatter-codec` module.
 */
@Injectable()
export class GitHubSyncService {
  private readonly logger = new Logger(GitHubSyncService.name);
  readonly promptsRepo: string;
  readonly skillsRepo: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly http: GitHubHttpClient,
    private readonly shaTracker: GitHubShaTracker,
  ) {
    this.promptsRepo = this.configService.get<string>(
      'GITHUB_PROMPTS_REPO',
      'Reclyptor/Prompts',
    );
    this.skillsRepo = this.configService.get<string>(
      'GITHUB_SKILLS_REPO',
      'Reclyptor/Skills',
    );
  }

  get enabled(): boolean {
    return this.http.enabled;
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
      const headSha = await this.http.getHeadSha(this.promptsRepo);
      const storedSha = await this.shaTracker.get(this.promptsRepo);

      if (headSha === storedSha) {
        this.logger.debug('Prompts repo unchanged, skipping sync');
        return result;
      }

      const tree = await this.http.fetchTree(this.promptsRepo);
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

          const file = await this.http.fetchFile(this.promptsRepo, entry.path);
          const { meta, content } = parseFrontmatter(file.content);

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
          const msg = `Failed to sync prompt "${slug}": ${err instanceof Error ? err.message : String(err)}`;
          result.errors.push(msg);
          this.logger.error(msg);
        }
      }

      await this.shaTracker.set(this.promptsRepo, headSha);
      this.logger.log(
        `Prompts sync complete: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`,
      );
    } catch (err) {
      const msg = `Prompts sync failed: ${err instanceof Error ? err.message : String(err)}`;
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
      const headSha = await this.http.getHeadSha(this.skillsRepo);
      const storedSha = await this.shaTracker.get(this.skillsRepo);

      if (headSha === storedSha) {
        this.logger.debug('Skills repo unchanged, skipping sync');
        return result;
      }

      const tree = await this.http.fetchTree(this.skillsRepo);

      // Group files by top-level directory
      const skillDirs = new Map<string, typeof tree>();
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
          const compositeSha = computeCompositeSha(entries);
          const existing = await skillModel.findOne({ name }).exec();

          if (existing && existing.seedHash === compositeSha) {
            result.unchanged++;
            continue;
          }

          const file = await this.http.fetchFile(this.skillsRepo, skillMd.path);
          const { meta, content } = parseSkillFrontmatter(file.content);

          const supplementary: { path: string; content: string }[] = [];
          for (const entry of entries) {
            if (entry.path === `${name}/SKILL.md`) continue;
            const relPath = entry.path.slice(name.length + 1);
            const fetched = await this.http.fetchFile(
              this.skillsRepo,
              entry.path,
            );
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
          const msg = `Failed to sync skill "${name}": ${err instanceof Error ? err.message : String(err)}`;
          result.errors.push(msg);
          this.logger.error(msg);
        }
      }

      await this.shaTracker.set(this.skillsRepo, headSha);
      this.logger.log(
        `Skills sync complete: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`,
      );
    } catch (err) {
      const msg = `Skills sync failed: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      this.logger.error(msg);
    }

    return result;
  }

  // ── Push to GitHub ──────────────────────────────────────────────────

  async pushPrompt(
    slug: string,
    data: PromptFrontmatterData,
  ): Promise<string | null> {
    if (!this.enabled) return null;

    try {
      const fileContent = serializePromptFile(data);
      const existing = await this.http
        .fetchFile(this.promptsRepo, `${slug}.md`)
        .catch(() => null);
      const newSha = await this.http.putFile(
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
    data: SkillFrontmatterData & {
      files?: { path: string; content: string }[];
    },
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const skillMdContent = serializeSkillFile(data);
      const existing = await this.http
        .fetchFile(this.skillsRepo, `${name}/SKILL.md`)
        .catch(() => null);
      await this.http.putFile(
        this.skillsRepo,
        `${name}/SKILL.md`,
        skillMdContent,
        existing?.sha,
        `Update skill: ${name}`,
      );

      if (data.files) {
        for (const file of data.files) {
          const filePath = `${name}/${file.path}`;
          const existingFile = await this.http
            .fetchFile(this.skillsRepo, filePath)
            .catch(() => null);
          await this.http.putFile(
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
      const existing = await this.http.fetchFile(
        this.promptsRepo,
        `${slug}.md`,
      );
      await this.http.deleteFile(
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
      const tree = await this.http.fetchTree(this.skillsRepo);
      const skillFiles = tree.filter((e) => e.path.startsWith(`${name}/`));

      for (const entry of skillFiles) {
        await this.http.deleteFile(
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
}
