import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { Skill, SkillDocument } from './skill.schema';
import type { CreateSkillDto, UpdateSkillDto } from './skills.dto';
import { ContentScannerService } from '../security/content-scanner.service';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { SkillSyncStrategy } from './skill-sync.strategy';

const CACHE_PREFIX = 'skill:';
const CACHE_TTL = 300;

@Injectable()
export class SkillsService implements OnModuleInit {
  private readonly logger = new Logger(SkillsService.name);

  constructor(
    @InjectModel(Skill.name)
    private readonly skillModel: Model<SkillDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly syncStrategy: SkillSyncStrategy,
    @Optional() private readonly contentScanner?: ContentScannerService,
  ) {}

  onModuleInit(): void {
    this.syncFromGitHub().catch((err) =>
      this.logger.error(
        'GitHub sync failed, using existing MongoDB data:',
        err,
      ),
    );
  }

  async syncFromGitHub() {
    return this.syncStrategy.syncFromGitHub();
  }

  async create(dto: CreateSkillDto): Promise<Skill> {
    this.contentScanner?.assertSafe(dto.content, 'skill create');
    if (dto.description) {
      this.contentScanner?.assertSafe(
        dto.description,
        'skill create description',
      );
    }

    if (dto.files) {
      for (const f of dto.files) this.validateFilePath(f.path);
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
      origin: dto.origin ?? 'user',
    });
    const saved = await skill.save();
    await this.invalidateCache(dto.name);

    this.syncStrategy
      .pushSkill(dto.name, {
        content: dto.content,
        description: dto.description,
        license: dto.license,
        compatibility: dto.compatibility,
        allowedTools: dto.allowedTools,
        metadata: dto.metadata,
        files: dto.files,
      })
      .catch((err) =>
        this.logger.warn(`Failed to push skill "${dto.name}" to GitHub:`, err),
      );

    return saved;
  }

  async findAll(): Promise<Skill[]> {
    return this.skillModel.find().sort({ name: 1 }).exec();
  }

  async findByName(name: string): Promise<Skill | null> {
    const cacheKey = `${CACHE_PREFIX}${name}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return JSON.parse(cached) as Skill;
    } catch {
      this.logger.warn('Redis read failed, falling back to MongoDB');
    }

    const skill = await this.skillModel.findOne({ name }).exec();
    if (!skill) return null;

    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(skill.toObject()),
        'EX',
        CACHE_TTL,
      );
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
      this.contentScanner?.assertSafe(
        dto.description,
        'skill update description',
      );
    }

    const skill = await this.skillModel
      .findOneAndUpdate({ name }, { $set: dto }, { new: true })
      .exec();
    if (!skill) {
      throw new NotFoundException(`Skill "${name}" not found`);
    }
    await this.invalidateCache(name);

    this.syncStrategy
      .pushSkill(name, {
        content: skill.content,
        description: skill.description,
        license: skill.license,
        compatibility: skill.compatibility,
        allowedTools: skill.allowedTools,
        metadata: skill.metadata,
        files: skill.files,
      })
      .catch((err) =>
        this.logger.warn(`Failed to push skill "${name}" to GitHub:`, err),
      );

    return skill;
  }

  async remove(name: string): Promise<boolean> {
    const result = await this.skillModel.deleteOne({ name }).exec();
    if (result.deletedCount > 0) {
      await this.invalidateCache(name);
      this.syncStrategy
        .deleteSkillFiles(name)
        .catch((err) =>
          this.logger.warn(
            `Failed to delete skill "${name}" from GitHub:`,
            err,
          ),
        );
    }
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

  async addFile(
    name: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    this.validateFilePath(filePath);
    const skill = await this.skillModel.findOne({ name }).exec();
    if (!skill) throw new NotFoundException(`Skill "${name}" not found`);
    if (skill.files.some((f) => f.path === filePath)) {
      throw new Error(`File "${filePath}" already exists in skill "${name}"`);
    }
    await this.skillModel.updateOne(
      { name },
      { $push: { files: { path: filePath, content } } },
    );
    await this.invalidateCache(name);
  }

  async updateFile(
    name: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    this.validateFilePath(filePath);
    const result = await this.skillModel.updateOne(
      { name, 'files.path': filePath },
      { $set: { 'files.$.content': content } },
    );
    if (result.matchedCount === 0) {
      throw new NotFoundException(
        `File "${filePath}" not found in skill "${name}"`,
      );
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

  private validateFilePath(filePath: string): void {
    const ALLOWED_PREFIXES = ['references/', 'templates/', 'scripts/'];
    const hasSlash = filePath.includes('/');
    if (hasSlash && !ALLOWED_PREFIXES.some((p) => filePath.startsWith(p))) {
      throw new Error(
        `Invalid file path "${filePath}". Subdirectory files must use: ${ALLOWED_PREFIXES.join(', ')}`,
      );
    }
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
}
