import { Injectable } from '@nestjs/common';
import { StateService } from '../state/state.service';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import { LoopDetectionService } from '../tools/loop-detection.service';
import type { ToolCallBlock } from '../../chats/chat.schema';
import type {
  ThinkingDeltaData,
  ThinkingDoneData,
  TextDeltaData,
  ToolCallStartedData,
  ToolCallExecutingData,
  ToolCallResultData,
  ToolCallErrorData,
  SubagentSpawnedData,
  SubagentCompletedData,
  SubagentFailedData,
  AgentEventType,
} from '../streaming/stream.interfaces';

const SUBAGENT_TOOL_NAMES = new Set(['sessions_spawn', 'agent_message']);
const MAX_EVENT_RESULT_LENGTH = 5000;

function truncateResult(value: unknown): unknown {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (!str || str.length <= MAX_EVENT_RESULT_LENGTH) return value;
  return (
    str.slice(0, MAX_EVENT_RESULT_LENGTH) +
    `\n...[truncated, ${str.length} chars total]`
  );
}

export interface StreamReductionInput {
  runID: string;
  threadID: string;
  stream: AsyncIterable<unknown>;
  runPluginHooks: <T>(type: string, args: T) => Promise<void>;
}

export interface StreamReductionResult {
  accumulatedReasoning: string;
  accumulatedText: string;
  lastThinkingDuration: number | undefined;
  yieldRequested: boolean;
  toolCallBlocks: ToolCallBlock[];
}

interface PendingToolCall {
  toolName: string;
  args: Record<string, unknown>;
  startedAt: number;
}

/**
 * Owns the per-stream reduction: consumes an async stream of AI SDK
 * parts, accumulates reasoning/text/tool-call state, emits the
 * corresponding SSE events, persists tool-call status to MongoDB,
 * records loop-detection signals, and runs plugin pre/post tool hooks.
 *
 * The orchestrator owns the outer iteration loop and feeds one stream
 * per outer iteration. The reducer returns the accumulated state which
 * the orchestrator merges into its run-level totals.
 */
@Injectable()
export class StreamEventReducer {
  constructor(
    private readonly stateService: StateService,
    private readonly eventEmitter: AgentEventEmitter,
    private readonly loopDetection: LoopDetectionService,
  ) {}

  async reduce(input: StreamReductionInput): Promise<StreamReductionResult> {
    const { runID, threadID, stream, runPluginHooks } = input;

    let accumulatedReasoning = '';
    let accumulatedText = '';
    let thinkingStartTime: number | null = null;
    let lastThinkingDuration: number | undefined;
    let yieldRequested = false;
    const pendingToolArgs = new Map<string, PendingToolCall>();
    const toolCallBlocks: ToolCallBlock[] = [];

    // The AI SDK's stream-part discriminated union is too narrow to
    // share between this reducer and its caller without re-exporting
    // half the SDK's types. The runtime shapes used here are stable
    // and well-known (toolCallId/toolName/input/output/error/etc.).
    type StreamPart = {
      type: string;
      text?: string;
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
      output?: unknown;
      error?: unknown;
    };

    for await (const partRaw of stream) {
      const part = partRaw as StreamPart;
      switch (part.type) {
        case 'reasoning-start':
          thinkingStartTime = Date.now();
          break;
        case 'reasoning-delta':
          accumulatedReasoning += part.text ?? '';
          await this.emit(runID, threadID, 'thinking.delta', {
            content: part.text ?? '',
          } satisfies ThinkingDeltaData);
          break;
        case 'reasoning-end':
          if (thinkingStartTime !== null) {
            lastThinkingDuration = Math.round(
              (Date.now() - thinkingStartTime) / 1000,
            );
            thinkingStartTime = null;
          }
          await this.emit(runID, threadID, 'thinking.done', {
            content: accumulatedReasoning,
          } satisfies ThinkingDoneData);
          break;
        case 'text-delta':
          accumulatedText += part.text ?? '';
          await this.emit(runID, threadID, 'text.delta', {
            content: part.text ?? '',
          } satisfies TextDeltaData);
          break;
        case 'tool-call': {
          const toolCallID = String(part.toolCallId);
          const toolName = String(part.toolName);
          const args = (part.input ?? {}) as Record<string, unknown>;
          pendingToolArgs.set(toolCallID, {
            toolName,
            args,
            startedAt: Date.now(),
          });
          toolCallBlocks.push({
            toolCallID,
            toolName,
            args,
            status: 'executing',
          });
          await this.emit(runID, threadID, 'tool_call.started', {
            toolCallID,
            toolName,
            args,
          } satisfies ToolCallStartedData);
          await runPluginHooks('onPreToolCall', {
            toolName,
            args,
            threadID,
            runID,
          });
          await this.stateService.recordToolCall(
            threadID,
            toolName,
            args,
            toolCallID,
          );
          await this.stateService.markToolCallExecuting(threadID, toolCallID);
          await this.emit(runID, threadID, 'tool_call.executing', {
            toolCallID,
            toolName,
          } satisfies ToolCallExecutingData);
          break;
        }
        case 'tool-result': {
          const toolCallID = String(part.toolCallId);
          const toolName = String(part.toolName);
          const output = part.output;
          const pending = pendingToolArgs.get(toolCallID);
          this.loopDetection.record(runID, toolName, pending?.args ?? {});
          const block = toolCallBlocks.find((b) => b.toolCallID === toolCallID);
          if (block) {
            block.status = 'completed';
            block.result = output;
          }
          await this.stateService.markToolCallCompleted(
            threadID,
            toolCallID,
            output,
          );
          await this.emit(runID, threadID, 'tool_call.result', {
            toolCallID,
            toolName,
            result: truncateResult(output),
            success: true,
          } satisfies ToolCallResultData);
          await runPluginHooks('onPostToolCall', {
            toolName,
            args: pending?.args ?? {},
            threadID,
            runID,
            result: output,
            success: true,
            durationMs: pending ? Date.now() - pending.startedAt : 0,
          });
          if (SUBAGENT_TOOL_NAMES.has(toolName)) {
            await this.emitSubagentEvents(runID, threadID, toolCallID, output);
            if (block) {
              block.isSubagent = true;
              const inner = (output as Record<string, unknown>)?.result as
                | Record<string, unknown>
                | undefined;
              if (inner) {
                block.subagentMeta = {
                  runID: (inner.runID ?? '') as string,
                  threadID: (inner.threadID ?? '') as string,
                  agentID: (inner.agentID ??
                    inner.targetAgentID ??
                    '') as string,
                  goal: (inner.goal ?? inner.message ?? '') as string,
                };
              }
            }
          }
          if (toolName === 'sessions_yield') {
            yieldRequested = true;
          }
          break;
        }
        case 'tool-error': {
          const toolCallID = String(part.toolCallId);
          const toolName = String(part.toolName);
          const errorStr =
            part.error instanceof Error
              ? part.error.message
              : String(part.error);
          const pending = pendingToolArgs.get(toolCallID);
          this.loopDetection.record(
            runID,
            toolName,
            pending?.args ?? {},
            errorStr,
          );
          const block = toolCallBlocks.find((b) => b.toolCallID === toolCallID);
          if (block) {
            block.status = 'failed';
            block.error = errorStr;
          }
          await this.stateService.markToolCallFailed(
            threadID,
            toolCallID,
            errorStr,
          );
          await this.emit(runID, threadID, 'tool_call.error', {
            toolCallID,
            toolName,
            error: errorStr,
          } satisfies ToolCallErrorData);
          await runPluginHooks('onPostToolCall', {
            toolName,
            args: pending?.args ?? {},
            threadID,
            runID,
            result: null,
            success: false,
            durationMs: pending ? Date.now() - pending.startedAt : 0,
          });
          if (SUBAGENT_TOOL_NAMES.has(toolName)) {
            const result = part.output;
            const subRunID = (result as Record<string, unknown>)?.runID as
              | string
              | undefined;
            if (subRunID) {
              await this.emit(runID, threadID, 'subagent.failed', {
                toolCallID,
                subagentRunID: subRunID,
                error: errorStr,
              } satisfies SubagentFailedData);
            }
          }
          break;
        }
      }
    }

    return {
      accumulatedReasoning,
      accumulatedText,
      lastThinkingDuration,
      yieldRequested,
      toolCallBlocks,
    };
  }

  private async emitSubagentEvents(
    runID: string,
    threadID: string,
    toolCallID: string,
    output: unknown,
  ): Promise<void> {
    const result = output as Record<string, unknown> | undefined;
    if (!result?.result) return;
    const inner = result.result as Record<string, unknown>;
    const subRunID = (inner.runID ?? '') as string;
    const subThreadID = (inner.threadID ?? '') as string;
    const agentID = (inner.agentID ?? inner.targetAgentID ?? '') as string;
    const goal = (inner.goal ?? inner.message ?? '') as string;
    const status = (inner.status ?? '') as string;

    if (!subRunID) return;

    await this.emit(runID, threadID, 'subagent.spawned', {
      toolCallID,
      subagentRunID: subRunID,
      subagentThreadID: subThreadID,
      agentID,
      goal,
    } satisfies SubagentSpawnedData);

    if (status === 'completed') {
      await this.emit(runID, threadID, 'subagent.completed', {
        toolCallID,
        subagentRunID: subRunID,
        status,
        response: inner.response as string | undefined,
      } satisfies SubagentCompletedData);
    } else if (status === 'failed') {
      await this.emit(runID, threadID, 'subagent.failed', {
        toolCallID,
        subagentRunID: subRunID,
        error: (inner.error as string) ?? 'Unknown error',
      } satisfies SubagentFailedData);
    }
  }

  private async emit(
    runID: string,
    threadID: string,
    type: AgentEventType,
    data: unknown,
  ): Promise<void> {
    await this.eventEmitter.emitEvent(runID, threadID, type, data);
  }
}
