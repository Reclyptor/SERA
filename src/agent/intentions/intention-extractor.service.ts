import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { ModelRouterService } from '../model/model-router.service';
import { IntentionsService } from './intentions.service';

interface ExtractedIntention {
  kind?: string;
  summary?: string;
  suggestedText?: string;
  confidence?: number;
  dueAt?: string | null;
  subject?: string;
}

const VALID_KINDS = new Set([
  'event_check_in',
  'deadline_check',
  'care_check_in',
  'open_loop',
]);

const EXTRACTION_PROMPT = `You are the private reflection pass of an AI companion, run after a conversation turn. Identify future follow-ups the companion could CHOOSE to initiate on its own later — things the user mentioned but did NOT explicitly ask to be reminded about or tracked.

Only surface genuine, useful follow-ups a thoughtful companion would remember. Do NOT extract explicit requests, reminders the user asked for, tasks already handled, or routine acknowledgments.

For each follow-up provide:
- kind: one of "event_check_in" (a dated event they mentioned), "deadline_check" (a deadline worth a nudge), "care_check_in" (a personal or emotional thread worth following up on), "open_loop" (an unresolved thread)
- summary: a short private note of what you noticed (never shown to the user)
- suggestedText: the natural check-in message you would send when the time comes
- confidence: 0-1, how sure you are this is a worthwhile, non-intrusive follow-up
- dueAt: ISO 8601 timestamp when the follow-up becomes relevant, or null if none can be inferred
- subject: a 2-5 word canonical topic in lowercase for deduplication (e.g. "job interview", "mom surgery")

Return a JSON array. If there is nothing worth following up on, return [].`;

@Injectable()
export class IntentionExtractorService {
  private readonly logger = new Logger(IntentionExtractorService.name);

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly intentionsService: IntentionsService,
    private readonly configService: ConfigService,
  ) {}

  async extract(
    conversation: string,
    agentID: string,
    userID: string,
    threadID: string,
    runID: string,
  ): Promise<void> {
    if (
      this.configService.get<string>('INTENTION_EXTRACTION_ENABLED', 'true') !==
      'true'
    ) {
      return;
    }

    const minConfidence =
      parseFloat(
        this.configService.get<string>('INTENTION_MIN_CONFIDENCE', '0.6'),
      ) || 0.6;

    try {
      const result = await this.modelRouter.generate({
        messages: [
          {
            role: 'user',
            content: `${EXTRACTION_PROMPT}\n\n---\n\n${conversation.slice(0, 4000)}`,
          },
        ],
        maxOutputTokens: 1024,
        temperature: 0,
      });

      const text = result.text?.trim();
      if (!text) return;

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const raw: unknown = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(raw) || raw.length === 0) return;

      let saved = 0;
      for (const item of raw as ExtractedIntention[]) {
        if (!item.suggestedText || !item.kind || !VALID_KINDS.has(item.kind)) {
          continue;
        }
        const confidence =
          typeof item.confidence === 'number' ? item.confidence : 0;
        if (confidence < minConfidence) continue;

        const subject = (item.subject ?? item.summary ?? item.suggestedText)
          .toLowerCase()
          .trim();
        const dedupeKey = createHash('sha256')
          .update(`${agentID}|${item.kind}|${subject}`)
          .digest('hex');

        const inferredAt = item.dueAt ? new Date(item.dueAt) : undefined;
        const validInferred =
          inferredAt && !Number.isNaN(inferredAt.getTime())
            ? inferredAt
            : undefined;
        const earliestAt = await this.intentionsService.clampEarliest(
          validInferred,
          agentID,
        );

        await this.intentionsService.upsert({
          agentID,
          userID,
          kind: item.kind,
          summary: item.summary ?? subject,
          suggestedText: item.suggestedText,
          confidence,
          earliestAt,
          dedupeKey,
          sourceRunID: runID,
          sourceThreadID: threadID,
        });
        saved++;
      }

      if (saved > 0) {
        this.logger.debug(`Extracted ${saved} intention(s) from run ${runID}`);
      }
    } catch (err) {
      this.logger.warn(
        `Intention extraction failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
