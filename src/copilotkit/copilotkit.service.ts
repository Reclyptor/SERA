import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { ImageStorage } from './storage/image.storage';

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

interface MessageAttachment {
  url: string;
  mimeType?: string;
  name?: string;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: MessageAttachment[];
}

interface RunAgentInput {
  threadId: string;
  messages: Message[];
  state?: Record<string, unknown>;
  forwardedProps?: Record<string, unknown>;
}

interface ThinkingConfig {
  enabled: boolean;
  budgetTokens: number;
}

@Injectable()
export class CopilotKitService {
  private readonly logger = new Logger(CopilotKitService.name);
  private readonly anthropic: Anthropic;
  private readonly model: string;
  private readonly thinkingConfig: ThinkingConfig;
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(
    private readonly configService: ConfigService,
    private readonly imageStorage: ImageStorage,
  ) {
    this.model = this.configService.getOrThrow<string>('ANTHROPIC_MODEL');
    this.anthropic = new Anthropic();

    // Extended thinking configuration
    this.thinkingConfig = {
      enabled: this.configService.get<string>('ANTHROPIC_THINKING_ENABLED', 'true') === 'true',
      budgetTokens: parseInt(
        this.configService.get<string>('ANTHROPIC_THINKING_BUDGET', '10000'),
        10,
      ),
    };

    if (this.thinkingConfig.enabled) {
      this.logger.log(
        `Extended thinking enabled with budget: ${this.thinkingConfig.budgetTokens} tokens`,
      );
    }
  }

  private get runtimeVersion(): string {
    return this.configService.getOrThrow<string>('COPILOTKIT_RUNTIME_VERSION');
  }

  private async fetchImageAsBase64(url: string): Promise<string> {
    try {
      // Handle data URLs directly
      if (url.startsWith('data:')) {
        const base64Match = url.match(/^data:image\/[a-zA-Z]+;base64,(.+)$/);
        if (base64Match) {
          return base64Match[1];
        }
        throw new Error('Invalid data URL format');
      }

      // Fetch from URL
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return buffer.toString('base64');
    } catch (error) {
      this.logger.error(`Error fetching image from ${url}:`, error);
      throw error;
    }
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
        .map((m) => {
          // Check for image ID references like [IMG:uuid]
          const imageIdPattern = /\[IMG:([a-f0-9-]+)\]/g;
          const imageIds = Array.from(m.content.matchAll(imageIdPattern)).map(match => match[1]);
          
          if (imageIds.length === 0) {
            // No images, return as-is
            return {
              role: m.role as 'user' | 'assistant',
              content: m.content,
            };
          }

          // Has images - build multimodal content
          const contentBlocks: Anthropic.MessageParam['content'] = [];
          
          // Remove image markers and get clean text
          const cleanText = m.content.replace(imageIdPattern, '').trim();
          if (cleanText) {
            contentBlocks.push({
              type: 'text',
              text: cleanText,
            });
          }

          // Retrieve and add images
          for (const imageId of imageIds) {
            const image = this.imageStorage.get(imageId);
            if (image) {
              contentBlocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: image.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                  data: image.data,
                },
              });
              this.logger.log(`Including image ${imageId} in request`);
            } else {
              this.logger.warn(`Image ${imageId} not found in storage`);
            }
          }

          return {
            role: m.role as 'user' | 'assistant',
            content: contentBlocks.length > 0 ? contentBlocks : m.content,
          };
        });

      // Emit RUN_STARTED event (AG-UI protocol)
      this.sendSSEEvent(res, {
        type: 'RUN_STARTED',
        threadId,
        runId,
      });

      // Build request options
      const requestOptions: Anthropic.MessageCreateParams = {
        model: this.model,
        max_tokens: this.thinkingConfig.enabled ? 16000 : 4096,
        system: systemMessage?.content || 'You are SERA, a helpful AI assistant.',
        messages: conversationMessages,
      };

      // Add thinking configuration if enabled
      if (this.thinkingConfig.enabled) {
        (requestOptions as Anthropic.MessageCreateParams & {
          thinking: { type: 'enabled'; budget_tokens: number };
        }).thinking = {
          type: 'enabled',
          budget_tokens: this.thinkingConfig.budgetTokens,
        };
      }

      // Stream using the SDK's built-in events
      const stream = this.anthropic.messages.stream(requestOptions, {
        headers: this.thinkingConfig.enabled
          ? { 'anthropic-beta': 'interleaved-thinking-2025-05-14' }
          : undefined,
      });

      let textStarted = false;
      let thinkingStarted = false;

      // Handle thinking events - stream in real-time
      stream.on('thinking', (thinkingDelta) => {
        if (abortController.signal.aborted || !thinkingDelta) return;

        // Start message and thinking marker on first delta
        if (!thinkingStarted) {
          thinkingStarted = true;
          this.sendSSEEvent(res, {
            type: 'TEXT_MESSAGE_START',
            messageId,
            role: 'assistant',
          });
          this.sendSSEEvent(res, {
            type: 'TEXT_MESSAGE_CONTENT',
            messageId,
            delta: '[THINKING]\n' + thinkingDelta,
          });
        } else {
          // Stream subsequent thinking deltas
          this.sendSSEEvent(res, {
            type: 'TEXT_MESSAGE_CONTENT',
            messageId,
            delta: thinkingDelta,
          });
        }
      });

      // Handle text events
      stream.on('text', (textDelta) => {
        if (abortController.signal.aborted || !textDelta) return;

        // Close thinking and start text
        if (thinkingStarted && !textStarted) {
          textStarted = true;
          this.sendSSEEvent(res, {
            type: 'TEXT_MESSAGE_CONTENT',
            messageId,
            delta: '\n[/THINKING]\n\n' + textDelta,
          });
        } else {
          // Start message if no thinking occurred
          if (!thinkingStarted && !textStarted) {
            textStarted = true;
            this.sendSSEEvent(res, {
              type: 'TEXT_MESSAGE_START',
              messageId,
              role: 'assistant',
            });
          }

          // Stream text content
          this.sendSSEEvent(res, {
            type: 'TEXT_MESSAGE_CONTENT',
            messageId,
            delta: textDelta,
          });
        }
      });

      stream.on('error', (error) => {
        this.logger.error('Stream error:', error);
        this.sendSSEEvent(res, {
          type: 'RUN_ERROR',
          message: error.message,
        });
      });

      // Wait for stream to complete
      await stream.finalMessage();

      // End text message if started
      if (textStarted) {
        this.sendSSEEvent(res, {
          type: 'TEXT_MESSAGE_END',
          messageId,
        });
      }

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
