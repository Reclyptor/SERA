import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Skill, SkillDocument } from './skill.schema';
import { ModelRouterService } from '../model/model-router.service';
import { ToolsService } from '../tools/tools.service';
import { CURATOR_CONSOLIDATION_PROMPT } from './skill-review.prompts';

const STALE_DAYS = 30;
const ARCHIVE_DAYS = 90;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MIN_SKILLS_FOR_CONSOLIDATION = 5;
const CONSOLIDATION_MAX_STEPS = 12;

interface ConsolidationEntry {
  umbrella: string;
  absorbed: string[];
  reason: string;
}

interface ConsolidationReport {
  consolidations: ConsolidationEntry[];
  skipped: string[];
}

@Injectable()
export class SkillCuratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkillCuratorService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly curatorModel: string;

  constructor(
    @InjectModel(Skill.name)
    private readonly skillModel: Model<SkillDocument>,
    private readonly configService: ConfigService,
    private readonly modelRouter: ModelRouterService,
    private readonly toolsService: ToolsService,
  ) {
    this.intervalMs =
      parseInt(
        this.configService.get<string>(
          'SKILL_CURATOR_INTERVAL_MS',
          String(DEFAULT_INTERVAL_MS),
        ),
        10,
      ) || DEFAULT_INTERVAL_MS;

    this.curatorModel = this.configService.get<string>(
      'SKILL_CURATOR_MODEL',
      'anthropic/claude-sonnet-4-6',
    );
  }

  onModuleInit() {
    this.timer = setInterval(() => {
      this.curate().catch((err) => {
        this.logger.error('Curator cycle failed:', err);
      });
    }, this.intervalMs);

    this.logger.log(
      `Skill curator started (interval: ${Math.round(this.intervalMs / 60_000)}m)`,
    );
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async curate(): Promise<{
    staled: number;
    archived: number;
    consolidated: number;
  }> {
    // Phase 1: Automatic lifecycle transitions (no LLM)
    const counts = await this.applyLifecycleTransitions();

    // Phase 2: LLM-powered consolidation
    let consolidated = 0;
    try {
      const report = await this.consolidate();
      if (report) {
        consolidated = report.consolidations.length;
      }
    } catch (err) {
      this.logger.warn('Curator consolidation failed:', err);
    }

    return { ...counts, consolidated };
  }

  private async applyLifecycleTransitions(): Promise<{
    staled: number;
    archived: number;
  }> {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_DAYS * 86_400_000);
    const archiveThreshold = new Date(
      now.getTime() - ARCHIVE_DAYS * 86_400_000,
    );

    const protectedFilter = {
      seedHash: { $exists: false },
      origin: { $ne: 'seed' },
    };

    // Active → Stale: not used in 30 days
    const staleResult = await this.skillModel.updateMany(
      {
        status: 'active',
        ...protectedFilter,
        $or: [
          { lastUsedAt: { $lt: staleThreshold } },
          {
            lastUsedAt: { $exists: false },
            createdAt: { $lt: staleThreshold },
          },
        ],
      },
      {
        $set: {
          status: 'stale',
          curatorNotes: `Auto-staled: no usage since ${staleThreshold.toISOString().slice(0, 10)}`,
        },
      },
    );

    // Stale → Archived: not used in 90 days
    const archiveResult = await this.skillModel.updateMany(
      {
        status: 'stale',
        ...protectedFilter,
        $or: [
          { lastUsedAt: { $lt: archiveThreshold } },
          {
            lastUsedAt: { $exists: false },
            createdAt: { $lt: archiveThreshold },
          },
        ],
      },
      {
        $set: {
          status: 'archived',
          curatorNotes: `Auto-archived: no usage since ${archiveThreshold.toISOString().slice(0, 10)}`,
        },
      },
    );

    const counts = {
      staled: staleResult.modifiedCount,
      archived: archiveResult.modifiedCount,
    };

    if (counts.staled > 0 || counts.archived > 0) {
      this.logger.log(
        `Curator lifecycle: ${counts.staled} staled, ${counts.archived} archived`,
      );
    }

    return counts;
  }

  private async consolidate(): Promise<ConsolidationReport | null> {
    const agentSkills = await this.skillModel
      .find({
        origin: 'agent',
        status: { $in: ['active', 'stale'] },
      })
      .exec();

    if (agentSkills.length < MIN_SKILLS_FOR_CONSOLIDATION) {
      this.logger.debug(
        `Skipping consolidation: only ${agentSkills.length} agent skills (need ${MIN_SKILLS_FOR_CONSOLIDATION})`,
      );
      return null;
    }

    const toolContext = {
      threadID: `curator-${Date.now()}`,
      runID: `curator-run-${Date.now()}`,
      agentID: 'system-curator',
    };

    const tools = this.toolsService.getFilteredToolSet(toolContext, {
      mode: 'allow',
      tools: ['skills'],
    });

    const result = await this.modelRouter.generate({
      system: CURATOR_CONSOLIDATION_PROMPT,
      messages: [
        {
          role: 'user' as const,
          content:
            `Review and consolidate the skill library. ` +
            `There are currently ${agentSkills.length} agent-created skills (active or stale).`,
        },
      ],
      tools,
      stopSteps: CONSOLIDATION_MAX_STEPS,
      temperature: 0.1,
      options: { preferredModel: this.curatorModel },
    });

    const report = this.parseConsolidationReport(result.text);

    for (const entry of report.consolidations) {
      for (const absorbed of entry.absorbed) {
        await this.skillModel.updateOne(
          { name: absorbed },
          {
            $set: {
              absorbedInto: entry.umbrella,
              status: 'archived',
              curatorNotes: `Consolidated into "${entry.umbrella}": ${entry.reason}`,
            },
          },
        );
      }
    }

    const absorbedCount = report.consolidations.reduce(
      (sum, e) => sum + e.absorbed.length,
      0,
    );

    this.logger.log(
      `Curator consolidation: ${report.consolidations.length} merges, ` +
        `${absorbedCount} skills absorbed, ${report.skipped.length} skipped`,
    );

    return report;
  }

  private parseConsolidationReport(text: string): ConsolidationReport {
    const empty: ConsolidationReport = { consolidations: [], skipped: [] };
    if (!text) return empty;

    try {
      const raw = text.trim();
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw;
      const parsed = JSON.parse(jsonStr);

      return {
        consolidations: Array.isArray(parsed.consolidations)
          ? parsed.consolidations
          : [],
        skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
      };
    } catch {
      this.logger.debug('Curator produced no parseable consolidation report');
      return empty;
    }
  }
}
