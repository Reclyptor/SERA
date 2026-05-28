import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Skill, SkillDocument } from './skill.schema';
import { GitHubHttpClient } from '../../github/github-http-client.service';
import { GitHubShaTracker } from '../../github/github-sha-tracker.service';
import {
  parseSkillFrontmatter,
  serializeSkillFile,
  computeCompositeSha,
  type SkillFrontmatterData,
} from '../../github/frontmatter-codec';

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

/**
 * Owns the skill ↔ GitHub flow end-to-end: pull (syncFromGitHub), push
 * (pushSkill including supplementary files), and delete
 * (deleteSkillFiles). Holds the `SkillModel` directly so the audit's
 * "inverted DI" complaint against the prior
 * `GitHubSyncService.syncSkills(model)` shape is resolved here.
 */
@Injectable()
export class SkillSyncStrategy {
  private readonly logger = new Logger(SkillSyncStrategy.name);
  readonly repo: string;

  constructor(
    @InjectModel(Skill.name)
    private readonly skillModel: Model<SkillDocument>,
    private readonly configService: ConfigService,
    private readonly http: GitHubHttpClient,
    private readonly shaTracker: GitHubShaTracker,
  ) {
    this.repo = this.configService.get<string>(
      'GITHUB_SKILLS_REPO',
      'Reclyptor/Skills',
    );
  }

  get enabled(): boolean {
    return this.http.enabled;
  }

  async syncFromGitHub(): Promise<SyncResult> {
    if (!this.enabled)
      return { created: 0, updated: 0, unchanged: 0, errors: [] };

    const result: SyncResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: [],
    };

    try {
      const headSha = await this.http.getHeadSha(this.repo);
      const storedSha = await this.shaTracker.get(this.repo);

      if (headSha === storedSha) {
        this.logger.debug('Skills repo unchanged, skipping sync');
        return result;
      }

      const tree = await this.http.fetchTree(this.repo);

      // Group files by top-level directory
      const skillDirs = new Map<string, typeof tree>();
      for (const entry of tree) {
        const slashIdx = entry.path.indexOf('/');
        if (slashIdx === -1) continue;
        const dirName = entry.path.slice(0, slashIdx);
        if (!skillDirs.has(dirName)) skillDirs.set(dirName, []);
        skillDirs.get(dirName)!.push(entry);
      }

      for (const [name, entries] of skillDirs) {
        const skillMd = entries.find((e) => e.path === `${name}/SKILL.md`);
        if (!skillMd) continue;

        try {
          const compositeSha = computeCompositeSha(entries);
          const existing = await this.skillModel.findOne({ name }).exec();

          if (existing && existing.seedHash === compositeSha) {
            result.unchanged++;
            continue;
          }

          const file = await this.http.fetchFile(this.repo, skillMd.path);
          const { meta, content } = parseSkillFrontmatter(file.content);

          const supplementary: { path: string; content: string }[] = [];
          for (const entry of entries) {
            if (entry.path === `${name}/SKILL.md`) continue;
            const relPath = entry.path.slice(name.length + 1);
            const fetched = await this.http.fetchFile(this.repo, entry.path);
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
            await this.skillModel.updateOne({ name }, { $set: update });
            result.updated++;
            this.logger.log(`Updated skill "${name}" from GitHub`);
          } else {
            await this.skillModel.create({ name, ...update });
            result.created++;
            this.logger.log(`Created skill "${name}" from GitHub`);
          }
        } catch (err) {
          const msg = `Failed to sync skill "${name}": ${err instanceof Error ? err.message : String(err)}`;
          result.errors.push(msg);
          this.logger.error(msg);
        }
      }

      await this.shaTracker.set(this.repo, headSha);
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
        .fetchFile(this.repo, `${name}/SKILL.md`)
        .catch(() => null);
      await this.http.putFile(
        this.repo,
        `${name}/SKILL.md`,
        skillMdContent,
        existing?.sha,
        `Update skill: ${name}`,
      );

      if (data.files) {
        for (const file of data.files) {
          const filePath = `${name}/${file.path}`;
          const existingFile = await this.http
            .fetchFile(this.repo, filePath)
            .catch(() => null);
          await this.http.putFile(
            this.repo,
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

  async deleteSkillFiles(name: string): Promise<void> {
    if (!this.enabled) return;

    try {
      const tree = await this.http.fetchTree(this.repo);
      const skillFiles = tree.filter((e) => e.path.startsWith(`${name}/`));

      for (const entry of skillFiles) {
        await this.http.deleteFile(
          this.repo,
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
