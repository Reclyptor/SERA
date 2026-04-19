import { Injectable, Logger, NotFoundException, Optional, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { Skill, SkillDocument } from './skill.schema';
import type { CreateSkillDto, UpdateSkillDto } from './skills.dto';
import { ContentScannerService } from '../security/content-scanner.service';

const SEEDS_DIR = join(__dirname, 'seeds');

@Injectable()
export class SkillsService implements OnModuleInit {
  private readonly logger = new Logger(SkillsService.name);

  constructor(
    @InjectModel(Skill.name)
    private readonly skillModel: Model<SkillDocument>,
    private readonly configService: ConfigService,
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
      displayName: dto.displayName,
      description: dto.description,
      content: dto.content,
      allowedTools: dto.allowedTools ?? [],
      triggerKeywords: dto.triggerKeywords ?? [],
      agentIDs: dto.agentIDs ?? [],
      priority: dto.priority ?? 0,
      enabled: dto.enabled ?? true,
      compatibility: dto.compatibility,
    });
    return skill.save();
  }

  async findAll(): Promise<Skill[]> {
    return this.skillModel.find().sort({ priority: -1 }).exec();
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

  /**
   * Find skills relevant to a query, optionally scoped to an agent.
   * Matches on keyword overlap and allowed tool intersection.
   */
  async findRelevant(
    query: string,
    agentID?: string,
    availableTools?: string[],
  ): Promise<Skill[]> {
    const filter: Record<string, unknown> = { enabled: true };

    const skills = await this.skillModel
      .find(filter)
      .sort({ priority: -1 })
      .exec();

    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 4);

    const scored = skills
      .filter((skill) => {
        if (skill.agentIDs.length > 0 && agentID) {
          if (!skill.agentIDs.includes(agentID)) return false;
        }

        if (skill.compatibility?.tools?.length && availableTools) {
          const missing = skill.compatibility.tools.filter(
            (t) => !availableTools.includes(t),
          );
          if (missing.length > 0) return false;
        }

        if (skill.compatibility?.env?.length) {
          const missingEnv = skill.compatibility.env.filter(
            (e) => !this.configService.get(e),
          );
          if (missingEnv.length > 0) return false;
        }

        return true;
      })
      .map((skill) => {
        let score = skill.priority;

        const keywords = skill.triggerKeywords.map((k) => k.toLowerCase());
        for (const word of queryWords) {
          if (keywords.some((k) => k === word || (word.length >= 4 && k.includes(word)) || (k.length >= 4 && word.includes(k)))) {
            score += 10;
          }
        }

        const desc = skill.description.toLowerCase();
        for (const word of queryWords) {
          if (desc.includes(word)) {
            score += 2;
          }
        }

        return { skill, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map((entry) => entry.skill);
  }

  /**
   * Format matched skills into a prompt section.
   */
  formatForPrompt(skills: Skill[]): string {
    if (skills.length === 0) return '';

    const sections = skills.map(
      (s) => `### ${s.displayName ?? s.name}\n${s.content}`,
    );

    return `## Skills\n\n${sections.join('\n\n')}`;
  }

  private async seedFromFiles(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(SEEDS_DIR);
    } catch {
      this.logger.warn('Skills seeds directory not found, skipping');
      return;
    }

    const mdFiles = files.filter((f) => f.endsWith('.md'));

    for (const file of mdFiles) {
      const name = basename(file, '.md');
      const filePath = join(SEEDS_DIR, file);

      try {
        const raw = (await readFile(filePath, 'utf-8')).trimEnd();
        const hash = createHash('sha256').update(raw).digest('hex');
        const { meta, content } = this.parseFrontmatter(raw);

        const existing = await this.skillModel.findOne({ name }).exec();

        if (!existing) {
          await this.skillModel.create({
            name,
            displayName: meta.displayName,
            description: meta.description ?? `Seeded from ${file}`,
            content,
            allowedTools: meta.allowedTools ?? [],
            triggerKeywords: meta.triggerKeywords ?? [],
            agentIDs: meta.agentIDs ?? [],
            priority: meta.priority ?? 0,
            enabled: true,
            compatibility: meta.compatibility,
            seedHash: hash,
          });
          this.logger.log(`Seeded skill "${name}" from ${file}`);
        } else if (existing.seedHash !== hash) {
          await this.skillModel.updateOne(
            { name },
            {
              $set: {
                displayName: meta.displayName,
                description: meta.description ?? existing.description,
                content,
                allowedTools: meta.allowedTools ?? existing.allowedTools,
                triggerKeywords: meta.triggerKeywords ?? existing.triggerKeywords,
                priority: meta.priority ?? existing.priority,
                compatibility: meta.compatibility ?? existing.compatibility,
                seedHash: hash,
              },
            },
          );
          this.logger.log(`Updated skill "${name}" from ${file} (content changed)`);
        }
      } catch (err) {
        this.logger.error(`Failed to seed skill from ${file}:`, err);
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
      const meta = JSON.parse(frontmatter);
      return { meta, content };
    } catch {
      this.logger.warn('Failed to parse skill frontmatter as JSON');
      return { meta: {}, content: raw };
    }
  }
}
