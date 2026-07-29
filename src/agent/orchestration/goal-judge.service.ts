import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModelRouterService } from '../model/model-router.service';
import type { AgentGoal } from './orchestration.interfaces';

export type GoalVerdictKind = 'done' | 'continue' | 'wait';

export interface GoalVerdict {
  verdict: GoalVerdictKind;
  nextStep?: string;
  reason?: string;
}

const DEFAULT_JUDGE_MODEL = 'anthropic/claude-haiku-4-5';

const SYSTEM_PROMPT =
  'You are the decision function of an autonomous AI companion. After it acts ' +
  'on its own initiative (no user present), you decide whether it should keep ' +
  'working right now. Respond with ONLY a JSON object: ' +
  '{"verdict":"done"|"continue"|"wait","nextStep":"<short concrete next action if continue>","reason":"<brief>"}. ' +
  'Choose "continue" ONLY when there is a concrete, worthwhile next step it can ' +
  'take immediately to make real progress. Choose "wait" when progress is ' +
  'blocked on time or an external event. DEFAULT to "done" when the objective ' +
  'is met or there is no genuinely valuable next step — never invent busywork ' +
  'to justify continuing.';

/**
 * Judge-gated persistence (§30.8). Decouples "do the work" (the main model) from
 * "should it keep going?" (this cheap auxiliary model). Fails open to `done` so
 * a broken or slow judge can never wedge the loop or cause a runaway — the turn
 * budget in the orchestrator is the other backstop.
 */
@Injectable()
export class GoalJudgeService {
  private readonly logger = new Logger(GoalJudgeService.name);

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly configService: ConfigService,
  ) {}

  isEnabled(): boolean {
    return (
      this.configService.get<string>('AUTONOMOUS_JUDGE_ENABLED', 'true') ===
      'true'
    );
  }

  async judge(goal: AgentGoal, response: string): Promise<GoalVerdict> {
    const model = this.configService.get<string>(
      'AUTONOMOUS_JUDGE_MODEL',
      DEFAULT_JUDGE_MODEL,
    );
    const [provider, ...modelParts] = model.split('/');
    const modelID = modelParts.join('/');

    const userMessage =
      `Objective (what the companion set out to do):\n${goal.userMessage.slice(0, 2000)}\n\n` +
      `What it just produced:\n${response.slice(0, 2000)}`;

    try {
      const result = await this.modelRouter.generate({
        messages: [{ role: 'user', content: userMessage }],
        system: SYSTEM_PROMPT,
        ...(provider && modelID
          ? {
              options: { preferredProvider: provider, preferredModel: model },
            }
          : {}),
        maxOutputTokens: 256,
        temperature: 0,
      });
      return this.parseVerdict(result.text);
    } catch (err) {
      this.logger.debug(
        `Goal judge failed, defaulting to done: ${err instanceof Error ? err.message : err}`,
      );
      return { verdict: 'done' };
    }
  }

  private parseVerdict(text: string | undefined): GoalVerdict {
    if (!text) return { verdict: 'done' };
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { verdict: 'done' };
    try {
      const raw = JSON.parse(match[0]) as {
        verdict?: string;
        nextStep?: string;
        reason?: string;
      };
      if (
        raw.verdict === 'continue' ||
        raw.verdict === 'wait' ||
        raw.verdict === 'done'
      ) {
        return {
          verdict: raw.verdict,
          nextStep: typeof raw.nextStep === 'string' ? raw.nextStep : undefined,
          reason: typeof raw.reason === 'string' ? raw.reason : undefined,
        };
      }
    } catch {
      // fall through to the safe default
    }
    return { verdict: 'done' };
  }
}
