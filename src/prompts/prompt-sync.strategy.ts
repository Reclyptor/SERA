import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Prompt, PromptDocument } from './prompt.schema';
import { GitHubHttpClient } from '../github/github-http-client.service';
import { GitHubShaTracker } from '../github/github-sha-tracker.service';
import {
  parseFrontmatter,
  serializePromptFile,
  type PromptFrontmatterData,
} from '../github/frontmatter-codec';

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

/**
 * Owns the prompt ↔ GitHub flow end-to-end: pull (syncFromGitHub),
 * push (pushPrompt), and delete (deletePromptFile). Holds the
 * `PromptModel` directly so callers don't have to inject a Mongo model
 * and pass it back through a generic sync method — the audit's
 * "inverted DI" complaint against the prior `GitHubSyncService.syncPrompts(model)`
 * shape is resolved here.
 */
@Injectable()
export class PromptSyncStrategy {
  private readonly logger = new Logger(PromptSyncStrategy.name);
  readonly repo: string;

  constructor(
    @InjectModel(Prompt.name)
    private readonly promptModel: Model<PromptDocument>,
    private readonly configService: ConfigService,
    private readonly http: GitHubHttpClient,
    private readonly shaTracker: GitHubShaTracker,
  ) {
    this.repo = this.configService.get<string>(
      'GITHUB_PROMPTS_REPO',
      'Reclyptor/Prompts',
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
        this.logger.debug('Prompts repo unchanged, skipping sync');
        return result;
      }

      const tree = await this.http.fetchTree(this.repo);
      const mdFiles = tree.filter(
        (e) => e.path.endsWith('.md') && !e.path.includes('/'),
      );

      for (const entry of mdFiles) {
        const slug = entry.path.replace(/\.md$/, '');

        try {
          const existing = await this.promptModel.findOne({ slug }).exec();

          if (existing && existing.seedHash === entry.sha) {
            result.unchanged++;
            continue;
          }

          const file = await this.http.fetchFile(this.repo, entry.path);
          const { meta, content } = parseFrontmatter(file.content);

          const update: Record<string, unknown> = {
            content,
            seedHash: entry.sha,
          };
          if (meta.description) update.description = meta.description;
          if (meta.extends) update.extends = meta.extends;
          if (meta.metadata) update.metadata = meta.metadata;

          if (existing) {
            await this.promptModel.updateOne({ slug }, { $set: update });
            result.updated++;
            this.logger.log(`Updated prompt "${slug}" from GitHub`);
          } else {
            await this.promptModel.create({ slug, ...update });
            result.created++;
            this.logger.log(`Created prompt "${slug}" from GitHub`);
          }
        } catch (err) {
          const msg = `Failed to sync prompt "${slug}": ${err instanceof Error ? err.message : String(err)}`;
          result.errors.push(msg);
          this.logger.error(msg);
        }
      }

      await this.shaTracker.set(this.repo, headSha);
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

  async pushPrompt(
    slug: string,
    data: PromptFrontmatterData,
  ): Promise<string | null> {
    if (!this.enabled) return null;

    try {
      const fileContent = serializePromptFile(data);
      const existing = await this.http
        .fetchFile(this.repo, `${slug}.md`)
        .catch(() => null);
      const newSha = await this.http.putFile(
        this.repo,
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

  async deletePromptFile(slug: string): Promise<void> {
    if (!this.enabled) return;

    try {
      const existing = await this.http.fetchFile(this.repo, `${slug}.md`);
      await this.http.deleteFile(
        this.repo,
        `${slug}.md`,
        existing.sha,
        `Delete prompt: ${slug}`,
      );
    } catch (err) {
      this.logger.warn(`Failed to delete prompt "${slug}" from GitHub:`, err);
    }
  }
}
