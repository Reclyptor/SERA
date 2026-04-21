import { Inject, Injectable, Logger, NotFoundException, Optional, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { readFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import * as yaml from 'js-yaml';
import Redis from 'ioredis';
import { Skill, SkillDocument } from './skill.schema';
import type { CreateSkillDto, UpdateSkillDto } from './skills.dto';
import { ContentScannerService } from '../security/content-scanner.service';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { SKILL_SEEDS_DIR } from '../../seeds/paths';

const CACHE_PREFIX = 'skill:';
const CACHE_TTL = 300;

@Injectable()
export class SkillsService implements OnModuleInit {
  private readonly logger = new Logger(SkillsService.name);

  constructor(
    @InjectModel(Skill.name)
    private readonly skillModel: Model<SkillDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
      files: dto.files ?? [],
    });
    const saved = await skill.save();
    await this.invalidateCache(dto.name);
    return saved;
  }

  async findAll(): Promise<Skill[]> {
    return this.skillModel.find().sort({ name: 1 }).exec();
  }

  async findByName(name: string): Promise<Skill | null> {
    const cacheKey = `${CACHE_PREFIX}${name}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return JSON.parse(cached);
    } catch {
      this.logger.warn('Redis read failed, falling back to MongoDB');
    }

    const skill = await this.skillModel.findOne({ name }).exec();
    if (!skill) return null;

    try {
      await this.redis.set(cacheKey, JSON.stringify(skill.toObject()), 'EX', CACHE_TTL);
    } catch {
      this.logger.warn('Redis write failed');
    }

    return skill;
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
    await this.invalidateCache(name);
    return skill;
  }

  async remove(name: string): Promise<boolean> {
    const result = await this.skillModel.deleteOne({ name }).exec();
    if (result.deletedCount > 0) await this.invalidateCache(name);
    return result.deletedCount > 0;
  }

  async listFiles(name: string): Promise<string[]> {
    const skill = await this.skillModel.findOne({ name }).exec();
    if (!skill) throw new NotFoundException(`Skill "${name}" not found`);
    return skill.files.map((f) => f.path);
  }

  async findFile(name: string, filePath: string): Promise<string | null> {
    const cacheKey = `${CACHE_PREFIX}${name}:file:${filePath}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return cached;
    } catch {
      this.logger.warn('Redis read failed, falling back to MongoDB');
    }

    const skill = await this.skillModel.findOne({ name }).exec();
    if (!skill) throw new NotFoundException(`Skill "${name}" not found`);
    const file = skill.files.find((f) => f.path === filePath);
    const content = file?.content ?? null;

    if (content !== null) {
      try {
        await this.redis.set(cacheKey, content, 'EX', CACHE_TTL);
      } catch {
        this.logger.warn('Redis write failed');
      }
    }

    return content;
  }

  async addFile(name: string, filePath: string, content: string): Promise<void> {
    const skill = await this.skillModel.findOne({ name }).exec();
    if (!skill) throw new NotFoundException(`Skill "${name}" not found`);
    if (skill.files.some((f) => f.path === filePath)) {
      throw new Error(`File "${filePath}" already exists in skill "${name}"`);
    }
    await this.skillModel.updateOne({ name }, { $push: { files: { path: filePath, content } } });
    await this.invalidateCache(name);
  }

  async updateFile(name: string, filePath: string, content: string): Promise<void> {
    const result = await this.skillModel.updateOne(
      { name, 'files.path': filePath },
      { $set: { 'files.$.content': content } },
    );
    if (result.matchedCount === 0) {
      throw new NotFoundException(`File "${filePath}" not found in skill "${name}"`);
    }
    await this.invalidateCache(name);
  }

  async removeFile(name: string, filePath: string): Promise<void> {
    const result = await this.skillModel.updateOne(
      { name },
      { $pull: { files: { path: filePath } } },
    );
    if (result.matchedCount === 0) {
      throw new NotFoundException(`Skill "${name}" not found`);
    }
    await this.invalidateCache(name);
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

    const sections = skills.map((s) => {
      const content = s.metadata
        ? this.substituteMetadata(s.content, s.metadata)
        : s.content;
      return `### ${s.name}\n${content}`;
    });

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
        const { meta, content } = this.parseFrontmatter(raw);
        const supplementaryFiles = await this.collectFiles(entryPath);

        const allFiles = [
          { path: 'SKILL.md', content: raw },
          ...supplementaryFiles,
        ].sort((a, b) => a.path.localeCompare(b.path));
        const hashInput = allFiles.map((f) => `${f.path}\n${f.content}`).join('\0');
        const hash = createHash('sha256').update(hashInput).digest('hex');

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
            files: supplementaryFiles,
            seedHash: hash,
          });
          this.logger.log(`Seeded skill "${name}" from ${entry}/`);
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
                files: supplementaryFiles,
                seedHash: hash,
              },
            },
          );
          this.logger.log(`Updated skill "${name}" (content changed)`);
        }
      } catch (err) {
        this.logger.error(`Failed to seed skill from ${entry}/SKILL.md:`, err);
      }
    }
  }

  private async collectFiles(
    skillDir: string,
    base?: string,
  ): Promise<{ path: string; content: string }[]> {
    const root = base ?? skillDir;
    const results: { path: string; content: string }[] = [];
    const dirEntries = await readdir(skillDir);

    for (const dirEntry of dirEntries) {
      if (!base && dirEntry === 'SKILL.md') continue;
      const fullPath = join(skillDir, dirEntry);
      const s = await stat(fullPath).catch(() => null);
      if (!s) continue;

      if (s.isDirectory()) {
        const nested = await this.collectFiles(fullPath, root);
        results.push(...nested);
      } else {
        const fileContent = (await readFile(fullPath, 'utf-8')).trimEnd();
        results.push({ path: relative(root, fullPath), content: fileContent });
      }
    }

    return results;
  }

  private substituteMetadata(content: string, metadata: Record<string, string>): string {
    return content.replace(/\{\{([\w-]+)\}\}/g, (match, key: string) => {
      return key in metadata ? metadata[key] : match;
    });
  }

  private async invalidateCache(name: string): Promise<void> {
    try {
      const pattern = `${CACHE_PREFIX}${name}*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) await this.redis.del(...keys);
    } catch {
      this.logger.warn('Redis cache invalidation failed');
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
