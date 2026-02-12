import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CopilotRuntime,
  AnthropicAdapter,
  copilotRuntimeNestEndpoint,
} from '@copilotkit/runtime';
import { BuiltInAgent } from '@copilotkitnext/agent';
import type { IncomingMessage, ServerResponse } from 'http';
import { MemoryService } from './memory/memory.service';

type RuntimeHandler = (
  req: IncomingMessage | Request,
  res?: ServerResponse,
) => Promise<void> | Promise<Response> | Response;

@Injectable()
export class CopilotKitService {
  private readonly logger = new Logger(CopilotKitService.name);
  private readonly handler: RuntimeHandler;

  constructor(
    private readonly configService: ConfigService,
    private readonly memoryService: MemoryService,
  ) {
    const model = this.configService.getOrThrow<string>('ANTHROPIC_MODEL');
    const maxOutputTokens = parseInt(
      this.configService.get<string>('ANTHROPIC_MAX_TOKENS', '16000'),
      10,
    );

    // BuiltInAgent is CopilotKit's canonical agent implementation.
    // It handles Anthropic streaming, tool calls, and AG-UI protocol events
    // via the Vercel AI SDK — no manual protocol wiring needed.
    const sera = new BuiltInAgent({
      model: `anthropic/${model}`,
      maxOutputTokens,
      maxSteps: 10,
    });

    const runtime = new CopilotRuntime({
      agents: { SERA: sera },
      middleware: {
        onAfterRequest: async ({ inputMessages, outputMessages, properties }) => {
          const userId = (properties as Record<string, unknown>)?.userId as
            | string
            | undefined;
          if (!userId) return;

          try {
            const lastUserMsg = [...inputMessages]
              .reverse()
              .find((m) => m.isTextMessage() && m.role === 'user');
            const lastAssistantMsg = [...outputMessages]
              .reverse()
              .find((m) => m.isTextMessage());

            if (
              lastUserMsg?.isTextMessage() &&
              lastAssistantMsg?.isTextMessage()
            ) {
              const conversation = `User: ${lastUserMsg.content}\n\nAssistant: ${lastAssistantMsg.content}`;
              this.memoryService
                .extractAndStore(userId, conversation)
                .catch((err) => {
                  this.logger.warn('Failed to extract memories:', err);
                });
            }
          } catch (error) {
            this.logger.warn('onAfterRequest memory extraction error:', error);
          }
        },
      },
    });

    // AnthropicAdapter is required as the serviceAdapter for runtime
    // initialization (telemetry, model metadata). The actual LLM calls
    // flow through BuiltInAgent since we registered it under "SERA".
    this.handler = copilotRuntimeNestEndpoint({
      runtime,
      serviceAdapter: new AnthropicAdapter({ model }),
      endpoint: '/api/v1/copilotkit',
    });

    this.logger.log(
      `CopilotKit runtime initialized — agent SERA (anthropic/${model})`,
    );
  }

  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    await this.handler(req, res);
  }
}
