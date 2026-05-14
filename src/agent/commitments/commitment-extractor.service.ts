import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModelRouterService } from '../model/model-router.service';
import { CommitmentsService } from './commitments.service';

interface ExtractedCommitment {
  description: string;
  dueAt?: string;
  tags?: string[];
}

const EXTRACTION_PROMPT = `You are analyzing a conversation between a user and an AI assistant. Extract any commitments, promises, or follow-ups the assistant made to the user.

For each commitment, provide:
- description: What was promised or committed to
- dueAt: ISO 8601 timestamp if a deadline was mentioned or can be inferred (null otherwise)
- tags: Relevant categories (e.g. "follow-up", "deadline", "reminder", "research", "delivery")

Return a JSON array. If no commitments were made, return an empty array [].
Only extract genuine commitments — not routine responses or acknowledgments.`;

@Injectable()
export class CommitmentExtractorService {
  private readonly logger = new Logger(CommitmentExtractorService.name);

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly commitmentsService: CommitmentsService,
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
      this.configService.get<string>('COMMITMENT_EXTRACTION_ENABLED', 'true') !== 'true'
    ) {
      return;
    }

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

      const parsed: ExtractedCommitment[] = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed) || parsed.length === 0) return;

      for (const item of parsed) {
        if (!item.description) continue;
        await this.commitmentsService.create({
          agentID,
          userID,
          description: item.description,
          dueAt: item.dueAt ? new Date(item.dueAt) : undefined,
          reminderAt: item.dueAt ? new Date(item.dueAt) : undefined,
          sourceRunID: runID,
          sourceThreadID: threadID,
          tags: item.tags ?? [],
        });
      }

      this.logger.debug(
        `Extracted ${parsed.length} commitments from run ${runID}`,
      );
    } catch (err) {
      this.logger.warn(
        `Commitment extraction failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
