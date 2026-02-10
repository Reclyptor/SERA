import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { ImageStorage } from './storage/image.storage';
import { StateService } from './state/state.service';
import { MemoryService } from './memory/memory.service';

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

interface CopilotKitTool {
  name: string;
  description: string;
  jsonSchema?: string;
  parameters?: Record<string, unknown>;
}

interface RunAgentInput {
  threadId: string;
  messages: Message[];
  tools?: CopilotKitTool[];
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
    private readonly stateService: StateService,
    private readonly memoryService: MemoryService,
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
    userId?: string,
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

    // Track run in state
    await this.stateService.startRun(threadId, runId);

    // Accumulate response for memory extraction
    let fullAssistantResponse = '';

    try {
      // Get the latest user message for memory retrieval
      const latestUserMessage = [...input.messages].reverse().find((m) => m.role === 'user');

      // Retrieve relevant memories for context
      let memoryContext = '';
      if (userId && latestUserMessage) {
        try {
          memoryContext = await this.memoryService.getContextForQuery(userId, latestUserMessage.content);
          if (memoryContext) {
            this.logger.debug(`Retrieved memory context for user ${userId}`);
          }
        } catch (error) {
          this.logger.warn('Failed to retrieve memories:', error);
        }
      }

      // Convert messages to Anthropic format
      const systemMessage = input.messages.find((m) => m.role === 'system');
      const conversationMessages = input.messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          // Check for image ID references like [IMG:uuid]
          const imageIDPattern = /\[IMG:([a-f0-9-]+)\]/g;
          const imageIDs = Array.from(m.content.matchAll(imageIDPattern)).map(match => match[1]);
          
          if (imageIDs.length === 0) {
            return {
              role: m.role as 'user' | 'assistant',
              content: m.content,
            };
          }

          // Has images - build multimodal content
          const contentBlocks: Anthropic.MessageParam['content'] = [];
          
          // Remove image markers and get clean text
          const cleanText = m.content.replace(imageIDPattern, '').trim();
          if (cleanText) {
            contentBlocks.push({
              type: 'text',
              text: cleanText,
            });
          }

          // Retrieve and add images
          for (const imageID of imageIDs) {
            const image = this.imageStorage.get(imageID);
            if (image) {
              contentBlocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: image.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                  data: image.data,
                },
              });
              this.logger.log(`Including image ${imageID} in request`);
            } else {
              this.logger.warn(`Image ${imageID} not found in storage`);
            }
          }

          return {
            role: m.role as 'user' | 'assistant',
            content: contentBlocks.length > 0 ? contentBlocks : m.content,
          };
        });

      // Build system prompt with memory context
      let systemPrompt = systemMessage?.content || 'You are SERA, a helpful AI assistant.';
      if (memoryContext) {
        systemPrompt = `${systemPrompt}\n\n${memoryContext}`;
      }

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
        system: systemPrompt,
        messages: conversationMessages,
      };

      // Convert CopilotKit frontend actions to Anthropic tool definitions
      const frontendTools = input.tools || [];
      if (frontendTools.length > 0) {
        requestOptions.tools = frontendTools.map((tool) => {
          let inputSchema: Anthropic.Tool['input_schema'] = { type: 'object' as const, properties: {} };
          if (tool.jsonSchema) {
            try {
              inputSchema = JSON.parse(tool.jsonSchema);
            } catch {
              // Fall back to empty schema
            }
          } else if (tool.parameters) {
            inputSchema = tool.parameters as Anthropic.Tool['input_schema'];
          }
          return {
            name: tool.name,
            description: tool.description,
            input_schema: inputSchema,
          };
        });
        this.logger.debug(`Registered ${frontendTools.length} frontend tools: ${frontendTools.map(t => t.name).join(', ')}`);
      }

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

      // Unified stream handler for thinking, text, and tool_use blocks
      let textMessageActive = false;
      let insideThinkingBlock = false;
      const activeToolCalls = new Map<number, { id: string; name: string }>();

      stream.on('streamEvent', (event) => {
        if (abortController.signal.aborted) return;

        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block;

            if (block.type === 'thinking') {
              // Start a text message if not active (thinking content is wrapped in [THINKING] markers)
              if (!textMessageActive) {
                textMessageActive = true;
                this.sendSSEEvent(res, { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
              }
              insideThinkingBlock = true;
              this.sendSSEEvent(res, { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: '[THINKING]\n' });
            } else if (block.type === 'text') {
              // Close thinking block if active
              if (insideThinkingBlock) {
                this.sendSSEEvent(res, { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: '\n[/THINKING]\n\n' });
                insideThinkingBlock = false;
              }
              // Start text message if not active
              if (!textMessageActive) {
                textMessageActive = true;
                this.sendSSEEvent(res, { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
              }
            } else if (block.type === 'tool_use') {
              // Close thinking/text before tool call
              if (insideThinkingBlock) {
                this.sendSSEEvent(res, { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: '\n[/THINKING]\n' });
                insideThinkingBlock = false;
              }
              if (textMessageActive) {
                this.sendSSEEvent(res, { type: 'TEXT_MESSAGE_END', messageId });
                textMessageActive = false;
              }
              // Emit action execution start
              activeToolCalls.set(event.index, { id: block.id, name: block.name });
              this.sendSSEEvent(res, {
                type: 'ActionExecutionStart',
                actionExecutionId: block.id,
                actionName: block.name,
              });
            }
            break;
          }
          case 'content_block_delta': {
            const delta = event.delta;

            if (delta.type === 'thinking_delta') {
              this.sendSSEEvent(res, { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: delta.thinking });
            } else if (delta.type === 'text_delta') {
              fullAssistantResponse += delta.text;
              this.sendSSEEvent(res, { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: delta.text });
            } else if (delta.type === 'input_json_delta') {
              const toolCall = activeToolCalls.get(event.index);
              if (toolCall) {
                this.sendSSEEvent(res, {
                  type: 'ActionExecutionArgs',
                  actionExecutionId: toolCall.id,
                  args: delta.partial_json,
                });
              }
            }
            break;
          }
          case 'content_block_stop': {
            const toolCall = activeToolCalls.get(event.index);
            if (toolCall) {
              this.sendSSEEvent(res, {
                type: 'ActionExecutionEnd',
                actionExecutionId: toolCall.id,
              });
              activeToolCalls.delete(event.index);
            }
            break;
          }
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

      // Close any remaining thinking/text blocks
      if (insideThinkingBlock) {
        this.sendSSEEvent(res, { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: '\n[/THINKING]\n' });
      }
      if (textMessageActive) {
        this.sendSSEEvent(res, { type: 'TEXT_MESSAGE_END', messageId });
      }

      // Extract and store memories from conversation (async, don't block response)
      if (userId && latestUserMessage) {
        this.extractMemoriesAsync(userId, latestUserMessage.content, fullAssistantResponse);
      }

      // Mark run as completed
      await this.stateService.completeRun(runId);

      // Emit RUN_FINISHED event
      this.sendSSEEvent(res, {
        type: 'RUN_FINISHED',
        threadId,
        runId,
      });
    } catch (error) {
      this.logger.error('Run error:', error);

      // Mark run as failed
      await this.stateService.failRun(runId, error instanceof Error ? error.message : 'Unknown error');

      this.sendSSEEvent(res, {
        type: 'RUN_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.activeRuns.delete(threadId);
      res.end();
    }
  }

  /**
   * Extract memories from conversation asynchronously
   */
  private extractMemoriesAsync(userId: string, userMessage: string, assistantResponse: string): void {
    const conversation = `User: ${userMessage}\n\nAssistant: ${assistantResponse}`;
    
    this.memoryService.extractAndStore(userId, conversation).catch((error) => {
      this.logger.warn('Failed to extract memories:', error);
    });
  }

  async connectAgent(
    agentId: string,
    body: unknown,
    res: Response,
  ): Promise<void> {
    if (agentId !== 'SERA') {
      throw new NotFoundException(`Agent '${agentId}' not found`);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
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
