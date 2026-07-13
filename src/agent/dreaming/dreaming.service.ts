import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModelRouterService } from '../model/model-router.service';
import { IntentionsService } from '../intentions/intentions.service';
import { MemoryService } from '../memory/memory.service';
import type { Intention } from '../intentions/intention.schema';

const DEFAULT_MODEL = 'anthropic/claude-haiku-4-5';

interface DreamGroup {
  agentID: string;
  userID: string;
  items: Intention[];
}

interface DreamSummary {
  agents: number;
  insights: number;
}

const SYSTEM_PROMPT =
  'You are the reflective "dreaming" pass of an AI companion, run nightly. ' +
  'Given the follow-ups it recently chose to act on for its user, distill only ' +
  'durable, general facts or preferences about the user that are worth ' +
  'remembering long-term. Ignore anything transient or one-off. Respond with ' +
  'ONLY a JSON array of short strings (each a single durable fact). Return [] if ' +
  'nothing is worth keeping.';

/**
 * Dreaming (§30.9 Phase 5). Complements the mechanical `MemoryConsolidator`
 * (§13, dedupe/decay/expire) with a *reflective* nightly pass: it reviews the
 * intentions the agent actually acted on and promotes durable facts about the
 * user into long-term memory, so self-initiated activity compounds into
 * lasting understanding. Also retires intentions past their relevance window.
 */
@Injectable()
export class DreamingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DreamingService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly lookbackMs: number;
  private readonly maxInsights: number;
  private readonly model: string;

  constructor(
    private readonly intentionsService: IntentionsService,
    private readonly memoryService: MemoryService,
    private readonly modelRouter: ModelRouterService,
    private readonly configService: ConfigService,
  ) {
    this.enabled =
      this.configService.get<string>('DREAMING_ENABLED', 'true') === 'true';
    this.intervalMs = Number(
      this.configService.get<string>('DREAMING_INTERVAL_MS', '86400000'),
    );
    this.lookbackMs =
      Number(this.configService.get<string>('DREAMING_LOOKBACK_HOURS', '24')) *
      3_600_000;
    this.maxInsights = Number(
      this.configService.get<string>('DREAMING_MAX_INSIGHTS', '3'),
    );
    this.model = this.configService.get<string>(
      'DREAMING_MODEL',
      DEFAULT_MODEL,
    );
  }

  onModuleInit(): void {
    if (!this.enabled || this.intervalMs <= 0) {
      this.logger.log('Dreaming disabled');
      return;
    }
    this.timer = setInterval(() => {
      this.runCycle().catch((err) => {
        this.logger.error('Dreaming cycle failed:', err);
      });
    }, this.intervalMs);
    this.logger.log(
      `Dreaming started (interval: ${Math.round(this.intervalMs / 60_000)}m)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Public entry point — exposed for tests and on-demand triggering. */
  async runCycle(now: Date = new Date()): Promise<DreamSummary> {
    if (this.running) {
      this.logger.warn('Dreaming cycle already running; skipping this tick');
      return { agents: 0, insights: 0 };
    }
    this.running = true;

    try {
      await this.intentionsService.expire(now);

      const cutoff = new Date(now.getTime() - this.lookbackMs);
      const acted = await this.intentionsService.findActedSince(cutoff);
      if (acted.length === 0) return { agents: 0, insights: 0 };

      const groups = new Map<string, DreamGroup>();
      for (const item of acted) {
        const key = `${item.agentID}::${item.userID}`;
        const group = groups.get(key) ?? {
          agentID: item.agentID,
          userID: item.userID,
          items: [],
        };
        group.items.push(item);
        groups.set(key, group);
      }

      let insights = 0;
      for (const group of groups.values()) {
        insights += await this.dreamForAgent(group);
      }

      this.logger.log(
        `Dreaming cycle done: ${groups.size} agent(s), ${insights} insight(s) promoted`,
      );
      return { agents: groups.size, insights };
    } finally {
      this.running = false;
    }
  }

  private async dreamForAgent(group: DreamGroup): Promise<number> {
    const lines = group.items
      .map((i) => `- [${i.kind}] ${i.summary}: ${i.suggestedText}`)
      .join('\n');
    const [provider, ...modelParts] = this.model.split('/');
    const modelID = modelParts.join('/');

    try {
      const result = await this.modelRouter.generate({
        messages: [
          {
            role: 'user',
            content: `Recent follow-ups acted on:\n${lines}`,
          },
        ],
        system: SYSTEM_PROMPT,
        ...(provider && modelID
          ? {
              options: { preferredProvider: provider, preferredModel: modelID },
            }
          : {}),
        maxOutputTokens: 512,
        temperature: 0,
      });

      const facts = this.parseFacts(result.text);
      let saved = 0;
      for (const fact of facts.slice(0, this.maxInsights)) {
        await this.memoryService.add(group.userID, {
          content: fact,
          source: 'run-extracted',
          confidence: 0.6,
          scope: { agentID: group.agentID },
          tags: ['dream'],
          metadata: { dream: true },
        });
        saved++;
      }
      return saved;
    } catch (err) {
      this.logger.warn(
        `Dreaming for agent ${group.agentID} failed: ${err instanceof Error ? err.message : err}`,
      );
      return 0;
    }
  }

  private parseFacts(text: string | undefined): string[] {
    if (!text) return [];
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const raw: unknown = JSON.parse(match[0]);
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((f): f is string => typeof f === 'string')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    } catch {
      return [];
    }
  }
}
