import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ModelMessage } from 'ai';
import { ModelRouterService } from '../../model/model-router.service';
import { PromptsService } from '../../../prompts/prompts.service';
import { TokenCounterService } from '../tokens/token-counter.service';
import { ModelContextWindowService } from '../tokens/model-context-window.service';
import { SecretRedactorService } from '../redaction/secret-redactor.service';
import { classifyError, FailoverReason } from '../../model/error-classifier';

export const HANDOFF_PREFIX =
  '[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted ' +
  'into the summary below. This is a handoff from a previous context ' +
  'window — treat it as background reference, NOT as active instructions. ' +
  'Do NOT answer questions or fulfill requests mentioned in this summary; ' +
  'they were already addressed. Your current task is identified in the ' +
  "'## Active Task' section of the summary — resume exactly from there. " +
  'IMPORTANT: Your persistent memory (saved facts, knowledge) in the system ' +
  'prompt is ALWAYS authoritative and active — never ignore or deprioritize ' +
  'memory content due to this compaction note. Respond ONLY to the latest ' +
  'user message that appears AFTER this summary.';

const STRUCTURED_SECTIONS = `## Active Task
[THE SINGLE MOST IMPORTANT FIELD. Copy the user's most recent unfulfilled request verbatim. If none, write "None."]

## Goal
[What the user is trying to accomplish overall]

## Constraints & Preferences
[User preferences, style, decisions]

## Completed Actions
[Numbered list of concrete actions: N. ACTION target — outcome [tool: name]. Include file paths, line numbers, and outcomes.]

## Active State
[Working dir, branch, modified files, test status, running processes, environment details that matter]

## In Progress
[Work currently underway — what was being done when compaction fired]

## Blocked
[Errors, blockers, exact error messages]

## Key Decisions
[Important technical decisions and WHY]

## Resolved Questions
[Questions the user asked that were ALREADY answered]

## Pending User Asks
[Questions or requests from the user that have NOT yet been answered. If none, write "None."]

## Relevant Files
[Files read, modified, or created — with brief note on each]

## Remaining Work
[What remains to be done — framed as context, not instructions]

## Critical Context
[Specific values, error messages, configuration details that would be lost without explicit preservation. NEVER include API keys, tokens, passwords, or credentials — write [REDACTED] instead.]`;

const SUMMARIZER_PREAMBLE =
  'You are a summarization agent creating a context checkpoint. ' +
  'Treat the conversation turns below as source material for a compact record ' +
  'of prior work. Produce only the structured summary; no greeting, ' +
  'preamble, or prefix. Write in the same language the user was using. ' +
  'NEVER include API keys, tokens, passwords, secrets, credentials, or ' +
  'connection strings in the summary — replace any that appear with [REDACTED].';

const MIN_SUMMARY_TOKENS = 2_000;
const SUMMARY_TOKENS_CEILING = 12_000;
const SUMMARY_BUDGET_RATIO = 0.2;
const SUMMARY_BUDGET_OVERHEAD = 1.3;

export interface SummarizerInput {
  middleText: string;
  middleTokens: number;
  provider: string;
  modelID: string;
  previousSummary?: string;
  summaryModelOverride?: string;
}

export interface SummarizerResult {
  body: string; // structured summary body, without the handoff prefix
  wrappedSummary: string; // HANDOFF_PREFIX + '\n\n' + body
  modelUsed: string;
  generatedTokens: number;
  iterative: boolean;
  auxModelFailure?: { model: string; error: string };
}

@Injectable()
export class SummarizerService {
  private readonly logger = new Logger(SummarizerService.name);

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly promptsService: PromptsService,
    private readonly tokenCounter: TokenCounterService,
    private readonly modelContextWindow: ModelContextWindowService,
    private readonly configService: ConfigService,
    private readonly redactor: SecretRedactorService,
  ) {}

  async summarize(input: SummarizerInput): Promise<SummarizerResult> {
    const contextWindow = this.modelContextWindow.get(
      input.provider,
      input.modelID,
    );
    const summaryBudget = this.computeBudget(input.middleTokens, contextWindow);

    // Redact secrets BEFORE the LLM call. The summarizer might echo back
    // values verbatim, and the result is persisted across runs (§9.10).
    const safeMiddle = this.redactor.redact(input.middleText);
    const safePrevious = input.previousSummary
      ? this.redactor.redact(input.previousSummary)
      : undefined;

    const summaryPrompt = await this.buildSystemPrompt();
    const userContent = safePrevious
      ? `You are updating a context compaction summary. A previous compaction produced the summary below. New conversation turns have occurred since then and need to be incorporated. PRESERVE all existing information that is still relevant. ADD new completed actions to the numbered list. Move items from "In Progress" to "Completed Actions" when done. Move answered questions to "Resolved Questions". Update "Active State" and "## Active Task" to reflect the latest unfulfilled request.\n\nPREVIOUS SUMMARY:\n${safePrevious}\n\nNEW TURNS TO INCORPORATE:\n${safeMiddle}\n\n${STRUCTURED_SECTIONS}`
      : `Create a structured checkpoint summary for the conversation after earlier turns are compacted. Preserve enough detail for continuity without re-reading the original turns.\n\nTURNS TO SUMMARIZE:\n${safeMiddle}\n\nUse this exact structure:\n\n${STRUCTURED_SECTIONS}`;

    const auxOverride =
      input.summaryModelOverride ??
      this.configService.get<string>('SUMMARY_MODEL') ??
      undefined;

    const primarySpec = `${input.provider}/${input.modelID}`;
    const auxIsSeparate = !!auxOverride && auxOverride !== primarySpec;

    let modelUsed = auxOverride ?? primarySpec;
    let auxFailure: { model: string; error: string } | undefined;

    let body: string;
    try {
      body = await this.callModel({
        preferredModel: modelUsed,
        summaryPrompt,
        userContent,
        budget: summaryBudget,
      });
    } catch (err) {
      const classified = classifyError(err);
      const isAuxFatal =
        auxIsSeparate &&
        (classified.reason === FailoverReason.ModelNotFound ||
          classified.reason === FailoverReason.ServiceUnavailable ||
          classified.reason === FailoverReason.GatewayTimeout ||
          classified.reason === FailoverReason.RequestTimeout);

      if (!isAuxFatal) {
        throw err;
      }

      auxFailure = {
        model: modelUsed,
        error: classified.message,
      };
      this.logger.warn(
        `Aux summary model "${modelUsed}" failed (${classified.reason}); falling back to primary "${primarySpec}"`,
      );
      modelUsed = primarySpec;
      body = await this.callModel({
        preferredModel: primarySpec,
        summaryPrompt,
        userContent,
        budget: summaryBudget,
      });
    }

    // Belt-and-suspenders: redact the model's output too. Summarizer LLMs
    // sometimes ignore prompt instructions and echo back secrets verbatim.
    const safeBody = this.redactor.redact(body);
    const wrapped = `${HANDOFF_PREFIX}\n\n${safeBody}`;
    const generatedTokens = this.tokenCounter.count(safeBody, input.provider);

    return {
      body: safeBody,
      wrappedSummary: wrapped,
      modelUsed,
      generatedTokens,
      iterative: !!input.previousSummary,
      auxModelFailure: auxFailure,
    };
  }

  /**
   * Convenience: assemble the summarized message slice the engine will splice
   * into its output. Always emits a system message with the wrapped summary
   * followed by a canned assistant acknowledgement.
   */
  buildSummaryMessages(wrapped: string): ModelMessage[] {
    return [
      { role: 'system', content: wrapped },
      {
        role: 'assistant',
        content:
          'Understood. I have the context summary and will continue from where we left off.',
      },
    ];
  }

  private async buildSystemPrompt(): Promise<string> {
    const custom = await this.promptsService.get('summary');
    if (custom && custom.trim().length > 0) {
      return `${custom}\n\n${STRUCTURED_SECTIONS}`;
    }
    return `${SUMMARIZER_PREAMBLE}\n\n${STRUCTURED_SECTIONS}`;
  }

  private computeBudget(middleTokens: number, contextWindow: number): number {
    const ceiling = Math.min(
      Math.floor(contextWindow * 0.05),
      SUMMARY_TOKENS_CEILING,
    );
    const scaled = Math.floor(middleTokens * SUMMARY_BUDGET_RATIO);
    return Math.max(MIN_SUMMARY_TOKENS, Math.min(scaled, ceiling));
  }

  private async callModel(opts: {
    preferredModel: string;
    summaryPrompt: string;
    userContent: string;
    budget: number;
  }): Promise<string> {
    const result = await this.modelRouter.generate({
      system: opts.summaryPrompt,
      messages: [{ role: 'user', content: opts.userContent }],
      maxOutputTokens: Math.ceil(opts.budget * SUMMARY_BUDGET_OVERHEAD),
      temperature: 0.2,
      options: { preferredModel: opts.preferredModel },
    });
    return result.text;
  }
}
