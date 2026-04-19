import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { Skill, SkillDocument } from './skill.schema';
import type { CreateSkillDto, UpdateSkillDto } from './skills.dto';
import { ContentScannerService } from '../security/content-scanner.service';

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);

  constructor(
    @InjectModel(Skill.name)
    private readonly skillModel: Model<SkillDocument>,
    private readonly configService: ConfigService,
    @Optional() private readonly contentScanner?: ContentScannerService,
  ) {}

  async create(dto: CreateSkillDto): Promise<Skill> {
    this.contentScanner?.assertSafe(dto.content, 'skill create');
    if (dto.description) {
      this.contentScanner?.assertSafe(dto.description, 'skill create description');
    }

    const skill = new this.skillModel({
      skillId: dto.skillId,
      name: dto.name,
      description: dto.description,
      content: dto.content,
      triggerTools: dto.triggerTools ?? [],
      triggerKeywords: dto.triggerKeywords ?? [],
      agentIds: dto.agentIds ?? [],
      priority: dto.priority ?? 0,
      enabled: dto.enabled ?? true,
      requirements: dto.requirements,
    });
    return skill.save();
  }

  async findAll(): Promise<Skill[]> {
    return this.skillModel.find().sort({ priority: -1 }).exec();
  }

  async findById(skillId: string): Promise<Skill | null> {
    return this.skillModel.findOne({ skillId }).exec();
  }

  async update(skillId: string, dto: UpdateSkillDto): Promise<Skill> {
    if (dto.content) {
      this.contentScanner?.assertSafe(dto.content, 'skill update');
    }
    if (dto.description) {
      this.contentScanner?.assertSafe(dto.description, 'skill update description');
    }

    const skill = await this.skillModel
      .findOneAndUpdate({ skillId }, { $set: dto }, { new: true })
      .exec();
    if (!skill) {
      throw new NotFoundException(`Skill "${skillId}" not found`);
    }
    return skill;
  }

  async remove(skillId: string): Promise<boolean> {
    const result = await this.skillModel.deleteOne({ skillId }).exec();
    return result.deletedCount > 0;
  }

  /**
   * Find skills relevant to a query, optionally scoped to an agent.
   * Matches on keyword overlap and trigger tool intersection.
   */
  async findRelevant(
    query: string,
    agentId?: string,
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
      .filter((w) => w.length > 2);

    const scored = skills
      .filter((skill) => {
        // Agent scope: skill must either have no agentIds (global) or include this agent
        if (skill.agentIds.length > 0 && agentId) {
          if (!skill.agentIds.includes(agentId)) return false;
        }

        // Requirements check: all required tools must be available
        if (skill.requirements?.tools?.length && availableTools) {
          const missing = skill.requirements.tools.filter(
            (t) => !availableTools.includes(t),
          );
          if (missing.length > 0) return false;
        }

        // Requirements check: all required env vars must be set
        if (skill.requirements?.env?.length) {
          const missingEnv = skill.requirements.env.filter(
            (e) => !this.configService.get(e),
          );
          if (missingEnv.length > 0) return false;
        }

        return true;
      })
      .map((skill) => {
        let score = skill.priority;

        // Keyword match scoring
        const keywords = skill.triggerKeywords.map((k) => k.toLowerCase());
        for (const word of queryWords) {
          if (keywords.some((k) => k.includes(word) || word.includes(k))) {
            score += 10;
          }
        }

        // Description match scoring
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
      (s) => `### ${s.name}\n${s.content}`,
    );

    return `## Skills\n\n${sections.join('\n\n')}`;
  }
}
