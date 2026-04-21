import { Injectable, Logger, NotFoundException, Optional, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { readFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import * as yaml from 'js-yaml';
import { Skill, SkillDocument } from './skill.schema';
import type { CreateSkillDto, UpdateSkillDto } from './skills.dto';
import { ContentScannerService } from '../security/content-scanner.service';
import { SKILL_SEEDS_DIR } from '../../seeds/paths';

@Injectable()
export class SkillsService implements OnModuleInit {
  private readonly logger = new Logger(SkillsService.name);

  constructor(
    @InjectModel(Skill.name)
    private readonly skillModel: Model<SkillDocument>,
    @Optional() private readonly contentScanner?: ContentScannerService,
  ) {}

  async onModuleInit() {
    await this.seedFromFiles();
  }

  async create(dto: CreateSkillDto): Promise<Skill> {
    this.contentScanner?.assertSafe(dto.content, 'skill create');
    if (dto.description) {
      this.contentScanner?.assertSafe(dto.description, 'skill create description');
    }

    const skill = new this.skillModel({
      name: dto.name,
      description: dto.description,
      content: dto.content,
      license: dto.license,
      compatibility: dto.compatibility,
      allowedTools: dto.allowedTools ?? [],
      metadata: dto.metadata,
    });
    return skill.save();
  }

  async findAll(): Promise<Skill[]> {
    return this.skillModel.find().sort({ name: 1 }).exec();
  }

  async findByName(name: string): Promise<Skill | null> {
    return this.skillModel.findOne({ name }).exec();
  }

  async update(name: string, dto: UpdateSkillDto): Promise<Skill> {
    if (dto.content) {
      this.contentScanner?.assertSafe(dto.content, 'skill update');
    }
    if (dto.description) {
      this.contentScanner?.assertSafe(dto.description, 'skill update description');
    }

    const skill = await this.skillModel
      .findOneAndUpdate({ name }, { $set: dto }, { new: true })
      .exec();
    if (!skill) {
      throw new NotFoundException(`Skill "${name}" not found`);
    }
    return skill;
  }

  async remove(name: string): Promise<boolean> {
    const result = await this.skillModel.deleteOne({ name }).exec();
    return result.deletedCount > 0;
  }

  async findRelevant(
    query: string,
    _agentID?: string,
    availableTools?: string[],
  ): Promise<Skill[]> {
    const skills = await this.skillModel.find().exec();

    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    return skills
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
  }

  formatForPrompt(
    skills: Skill[],
    _variables?: Record<string, string>,
  ): string {
    if (skills.length === 0) return '';

    const sections = skills.map(
      (s) => `### ${s.name}\n${s.content}`,
    );

    return `## Skills\n\n${sections.join('\n\n')}`;
  }

  private async seedFromFiles(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(SKILL_SEEDS_DIR);
    } catch {
      this.logger.warn('Skills seeds directory not found, skipping');
      return;
    }

    for (const entry of files) {
      const entryPath = join(SKILL_SEEDS_DIR, entry);
      const entryStat = await stat(entryPath).catch(() => null);
      if (!entryStat?.isDirectory()) continue;

      const skillFile = join(entryPath, 'SKILL.md');
      const name = entry;

      try {
        const raw = (await readFile(skillFile, 'utf-8')).trimEnd();
        const hash = createHash('sha256').update(raw).digest('hex');
        const { meta, content } = this.parseFrontmatter(raw);

        const existing = await this.skillModel.findOne({ name }).exec();

        if (!existing) {
          await this.skillModel.create({
            name,
            description: meta.description ?? `Seeded from ${entry}/SKILL.md`,
            content,
            license: meta.license,
            compatibility: meta.compatibility,
            allowedTools: meta.allowedTools ?? [],
            metadata: meta.metadata,
            seedHash: hash,
          });
          this.logger.log(`Seeded skill "${name}" from ${entry}/SKILL.md`);
        } else if (existing.seedHash !== hash) {
          await this.skillModel.updateOne(
            { name },
            {
              $set: {
                description: meta.description ?? existing.description,
                content,
                license: meta.license,
                compatibility: meta.compatibility ?? existing.compatibility,
                allowedTools: meta.allowedTools ?? existing.allowedTools,
                metadata: meta.metadata ?? existing.metadata,
                seedHash: hash,
              },
            },
          );
          this.logger.log(`Updated skill "${name}" from ${entry}/SKILL.md (content changed)`);
        }
      } catch (err) {
        this.logger.error(`Failed to seed skill from ${entry}/SKILL.md:`, err);
      }
    }
  }

  private parseFrontmatter(raw: string): {
    meta: Record<string, any>;
    content: string;
  } {
    if (!raw.startsWith('---')) {
      return { meta: {}, content: raw };
    }

    const endIndex = raw.indexOf('---', 3);
    if (endIndex === -1) {
      return { meta: {}, content: raw };
    }

    const frontmatter = raw.slice(3, endIndex).trim();
    const content = raw.slice(endIndex + 3).trim();

    try {
      const parsed = yaml.load(frontmatter) as Record<string, any>;
      if (!parsed || typeof parsed !== 'object') {
        return { meta: {}, content };
      }

      const meta: Record<string, any> = { ...parsed };

      // Convert spec field names to schema field names
      if (meta['allowed-tools']) {
        meta.allowedTools = (meta['allowed-tools'] as string).split(/\s+/);
        delete meta['allowed-tools'];
      }

      return { meta, content };
    } catch {
      this.logger.warn('Failed to parse skill frontmatter');
      return { meta: {}, content: raw };
    }
  }
}
