import { Injectable } from '@nestjs/common';
import type { ModelMessage } from 'ai';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import { AiSdkAgentRuntimeService } from './ai-sdk-agent-runtime.service';
import { AttachmentMessageResolverService } from './attachment-message-resolver.service';
import type { ModelRequestOptions } from '../model/model.interfaces';
import type {
  TextDeltaData,
  TextDoneData,
  ModelAttemptData,
} from '../streaming/stream.interfaces';

export interface ForceFinalAnswerInput {
  runID: string;
  threadID: string;
  userID: string;
  messages: ModelMessage[];
  systemPrompt: string;
  options: ModelRequestOptions;
  abortSignal: AbortSignal;
  initialText: string;
  breakerMessage: string;
}

/**
 * When the loop-detection service fires `circuit_breaker`, the agent is
 * stuck in a tool-call loop. This handler streams one more model attempt
 * with NO tools attached, instructing the model to produce a final
 * answer from the conversation so far. The resulting text becomes the
 * run's response. Extracted from the orchestrator because the recursive
 * `for await` reads and emits its own subset of stream events.
 */
@Injectable()
export class LoopCircuitBreakerHandler {
  constructor(
    private readonly agentRuntime: AiSdkAgentRuntimeService,
    private readonly attachmentMessageResolver: AttachmentMessageResolverService,
    private readonly eventEmitter: AgentEventEmitter,
  ) {}

  async forceFinalAnswer(input: ForceFinalAnswerInput): Promise<string> {
    const {
      runID,
      threadID,
      userID,
      messages,
      systemPrompt,
      options,
      abortSignal,
      initialText,
      breakerMessage,
    } = input;

    messages.push({
      role: 'user',
      content: `[SYSTEM] ${breakerMessage} You must provide a final answer now without calling any more tools.`,
    });

    const finalMessagesForModel = await this.attachmentMessageResolver.resolve(
      messages,
      userID,
    );
    const finalStream = await this.agentRuntime.streamAttempt({
      messages: finalMessagesForModel,
      system: systemPrompt,
      options,
      abortSignal,
      // SPEC §29.1: "Model attempts are emitted as structured stream
      // events." The force-final stream is a separate model call from
      // the main loop, so it surfaces its own attempt event to clients.
      onAttempt: async (attempt) => {
        await this.eventEmitter.emitEvent(runID, threadID, 'model.attempt', {
          attempt: attempt.attempt,
          provider: attempt.provider,
          modelID: attempt.modelID,
        } satisfies ModelAttemptData);
      },
    });

    let finalText = initialText;
    type StreamPart = { type: string; text?: string };
    for await (const partRaw of finalStream.fullStream) {
      const part = partRaw as StreamPart;
      if (part.type === 'text-delta') {
        finalText += part.text ?? '';
        await this.eventEmitter.emitEvent(runID, threadID, 'text.delta', {
          content: part.text ?? '',
        } satisfies TextDeltaData);
      }
    }

    if (finalText) {
      await this.eventEmitter.emitEvent(runID, threadID, 'text.done', {
        content: finalText,
      } satisfies TextDoneData);
    }

    return finalText;
  }
}
