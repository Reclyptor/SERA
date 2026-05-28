import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Skill, SkillDocument } from './skill.schema';

/**
 * Matches the user's current goal/query against the skill library and
 * formats the matches for the system prompt. Also records per-match
 * usage bookkeeping so the curator's lifecycle (active → stale →
 * archived) reflects actual model exposure rather than wall-clock age.
 *
 * Owns the read path for skills; the write path (CRUD, GitHub push,
 * cache) stays in `SkillsService` so the matcher remains side-effect
 * light apart from the usage bulkWrite.
 */
@Injectable()
export class SkillsMatcher {
  private readonly logger = new Logger(SkillsMatcher.name);

  constructor(
    @InjectModel(Skill.name)
    private readonly skillModel: Model<SkillDocument>,
  ) {}

  async findRelevant(
    query: string,
    availableTools?: string[],
  ): Promise<Skill[]> {
    const skills = await this.skillModel
      .find({ status: { $ne: 'archived' } })
      .exec();

    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    const matched = skills
      .filter((skill) => {
        if (skill.allowedTools.length > 0 && availableTools) {
          const hasRequired = skill.allowedTools.every((t) =>
            availableTools.includes(t),
          );
          if (!hasRequired) return false;
        }
        return true;
      })
      .map((skill) => {
        let score = 0;
        const desc = skill.description.toLowerCase();
        for (const word of queryWords) {
          if (desc.includes(word)) score += 2;
        }
        const nameWords = skill.name.split('-');
        for (const word of queryWords) {
          if (nameWords.some((n) => n === word || word.includes(n))) score += 5;
        }
        return { skill, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.skill);

    if (matched.length > 0) {
      void this.recordSkillUsage(matched.map((s) => s.name));
    }

    return matched;
  }

  formatForPrompt(skills: Skill[]): string {
    if (skills.length === 0) return '';

    const sections = skills.map((s) => {
      const content = s.metadata
        ? this.substituteMetadata(s.content, s.metadata)
        : s.content;
      return `### ${s.name}\n${content}`;
    });

    return `## Skills\n\n${sections.join('\n\n')}`;
  }

  private substituteMetadata(
    content: string,
    metadata: Record<string, unknown>,
  ): string {
    return content.replace(/\{\{([\w-]+)\}\}/g, (match, key: string) => {
      const value = metadata[key];
      if (value == null) return match;
      if (typeof value === 'string') return value;
      if (
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
      ) {
        return String(value);
      }
      // Objects/arrays/etc. render via JSON instead of '[object Object]'.
      return JSON.stringify(value);
    });
  }

  /**
   * lastUsedAt / usageCount are not consumed from the Redis cache (the
   * curator queries Mongo directly), so we intentionally skip cache
   * invalidation here to avoid a write storm on every prompt build.
   */
  private async recordSkillUsage(names: string[]): Promise<void> {
    try {
      await this.skillModel.bulkWrite(
        names.map((name) => ({
          updateOne: {
            filter: { name },
            update: {
              $set: { lastUsedAt: new Date(), status: 'active' },
              $inc: { usageCount: 1 },
            },
          },
        })),
        { ordered: false },
      );
    } catch (err) {
      this.logger.warn('Failed to record skill usage:', err);
    }
  }
}
