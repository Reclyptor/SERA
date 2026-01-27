import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

export interface AgentDescription {
  name: string;
  description?: string;
  className: string;
}

export interface RuntimeInfo {
  version: string;
  agents: Record<string, AgentDescription>;
  audioFileTranscriptionEnabled: boolean;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface RunAgentInput {
  threadId: string;
  messages: Message[];
  state?: Record<string, unknown>;
  forwardedProps?: Record<string, unknown>;
}

@Injectable()
export class CopilotKitService {
  private readonly logger = new Logger(CopilotKitService.name);
  private readonly anthropic: Anthropic;
  private readonly model: string;
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(private readonly configService: ConfigService) {
    this.model = this.configService.getOrThrow<string>('ANTHROPIC_MODEL');
    this.anthropic = new Anthropic();
  }

  private get runtimeVersion(): string {
    return this.configService.getOrThrow<string>('COPILOTKIT_RUNTIME_VERSION');
  }

  getRuntimeInfo(): RuntimeInfo {
    return {
      version: this.runtimeVersion,
      agents: {
        SERA: {
          name: 'SERA',
          description: 'AI Assistant powered by Claude',
          className: 'SeraAgent',
        },
      },
      audioFileTranscriptionEnabled: false,
    };
  }

  async runAgent(
    agentId: string,
    body: unknown,
    headers: Record<string, string>,
    res: Response,
  ): Promise<void> {
    if (agentId !== 'SERA') {
      throw new NotFoundException(`Agent '${agentId}' not found`);
    }

    const input = body as RunAgentInput;
    const threadId = input.threadId || crypto.randomUUID();
    const runId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Create abort controller for this run
    const abortController = new AbortController();
    this.activeRuns.set(threadId, abortController);

    try {
      // Convert messages to Anthropic format
      const systemMessage = input.messages.find((m) => m.role === 'system');
      const conversationMessages = input.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      // Emit RUN_STARTED event (AG-UI protocol)
      this.sendSSEEvent(res, {
        type: 'RUN_STARTED',
        threadId,
        runId,
      });

      // Emit TEXT_MESSAGE_START event
      this.sendSSEEvent(res, {
        type: 'TEXT_MESSAGE_START',
        messageId,
        role: 'assistant',
      });

      // Stream from Claude
      const stream = this.anthropic.messages.stream({
        model: this.model,
        max_tokens: 4096,
        system: systemMessage?.content || 'You are Sera, a helpful AI assistant.',
        messages: conversationMessages,
      });

      stream.on('text', (text) => {
        if (abortController.signal.aborted) return;

        // Emit TEXT_MESSAGE_CONTENT event
        this.sendSSEEvent(res, {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId,
          delta: text,
        });
      });

      stream.on('error', (error) => {
        this.logger.error('Stream error:', error);
        this.sendSSEEvent(res, {
          type: 'RUN_ERROR',
          message: error.message,
        });
      });

      await stream.finalMessage();

      // Emit TEXT_MESSAGE_END event
      this.sendSSEEvent(res, {
        type: 'TEXT_MESSAGE_END',
        messageId,
      });

      // Emit RUN_FINISHED event
      this.sendSSEEvent(res, {
        type: 'RUN_FINISHED',
        threadId,
        runId,
      });
    } catch (error) {
      this.logger.error('Run error:', error);
      this.sendSSEEvent(res, {
        type: 'RUN_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.activeRuns.delete(threadId);
      res.end();
    }
  }

  async connectAgent(
    agentId: string,
    body: unknown,
    res: Response,
  ): Promise<void> {
    if (agentId !== 'SERA') {
      throw new NotFoundException(`Agent '${agentId}' not found`);
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Connect endpoint - just acknowledge and keep alive
    // No specific event needed, just end the response
    res.end();
  }

  async stopAgent(
    agentId: string,
    threadId: string,
  ): Promise<{ success: boolean }> {
    const controller = this.activeRuns.get(threadId);
    if (controller) {
      controller.abort();
      this.activeRuns.delete(threadId);
      return { success: true };
    }
    return { success: false };
  }

  private sendSSEEvent(res: Response, data: unknown): void {
    const eventData = JSON.stringify(data);
    res.write(`data: ${eventData}\n\n`);
  }
}
