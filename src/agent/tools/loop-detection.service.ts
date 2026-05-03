import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  ToolCallRecord,
  LoopDetection,
  LoopType,
} from './loop-detection.interfaces';

const WINDOW_SIZE = 30;
const EXACT_REPEAT_THRESHOLD = 3;
const EXACT_REPEAT_WINDOW = 5;
const PING_PONG_WINDOW = 6;
const NO_PROGRESS_THRESHOLD = 3;
const CIRCUIT_BREAKER_LIMIT = 25;

@Injectable()
export class LoopDetectionService {
  private readonly logger = new Logger(LoopDetectionService.name);
  private readonly history = new Map<string, ToolCallRecord[]>();

  record(
    runID: string,
    toolName: string,
    args: Record<string, unknown>,
    error?: string,
  ): void {
    let records = this.history.get(runID);
    if (!records) {
      records = [];
      this.history.set(runID, records);
    }

    records.push({
      toolName,
      argsHash: this.hashArgs(toolName, args),
      error,
      timestamp: Date.now(),
    });

    if (records.length > WINDOW_SIZE) {
      records.splice(0, records.length - WINDOW_SIZE);
    }
  }

  detect(runID: string): LoopDetection | null {
    const records = this.history.get(runID);
    if (!records || records.length < 2) return null;

    return (
      this.detectExactRepeat(records) ??
      this.detectPingPong(records) ??
      this.detectNoProgress(records) ??
      this.detectCircuitBreaker(records)
    );
  }

  clear(runID: string): void {
    this.history.delete(runID);
  }

  private detectExactRepeat(records: ToolCallRecord[]): LoopDetection | null {
    const recent = records.slice(-EXACT_REPEAT_WINDOW);
    const counts = new Map<string, number>();

    for (const r of recent) {
      const count = (counts.get(r.argsHash) ?? 0) + 1;
      counts.set(r.argsHash, count);
    }

    for (const [hash, count] of counts) {
      if (count >= EXACT_REPEAT_THRESHOLD) {
        const match = recent.find((r) => r.argsHash === hash)!;
        return {
          type: 'exact_repeat',
          message: `Tool "${match.toolName}" called ${count} times with identical arguments in the last ${EXACT_REPEAT_WINDOW} calls. Try a different approach.`,
          toolName: match.toolName,
          callCount: count,
        };
      }
    }

    return null;
  }

  private detectPingPong(records: ToolCallRecord[]): LoopDetection | null {
    if (records.length < PING_PONG_WINDOW) return null;
    const recent = records.slice(-PING_PONG_WINDOW);

    const tools = recent.map((r) => r.toolName);
    const uniqueTools = new Set(tools);
    if (uniqueTools.size !== 2) return null;

    // Check A-B-A-B-A-B pattern
    for (let i = 2; i < tools.length; i++) {
      if (tools[i] !== tools[i - 2]) return null;
    }

    const [toolA, toolB] = [...uniqueTools];
    return {
      type: 'ping_pong',
      message: `Detected alternating pattern between "${toolA}" and "${toolB}" over ${PING_PONG_WINDOW} calls. Break the cycle — try a different tool or approach.`,
      toolName: toolA,
      callCount: PING_PONG_WINDOW,
    };
  }

  private detectNoProgress(records: ToolCallRecord[]): LoopDetection | null {
    const errorRecords = records
      .filter((r) => r.error)
      .slice(-NO_PROGRESS_THRESHOLD);

    if (errorRecords.length < NO_PROGRESS_THRESHOLD) return null;

    const first = errorRecords[0];
    const allSame = errorRecords.every(
      (r) => r.toolName === first.toolName && r.error === first.error,
    );

    if (!allSame) return null;

    return {
      type: 'no_progress',
      message: `Tool "${first.toolName}" failed ${NO_PROGRESS_THRESHOLD} times with the same error: "${first.error}". Stop retrying and try a different approach.`,
      toolName: first.toolName,
      callCount: NO_PROGRESS_THRESHOLD,
    };
  }

  private detectCircuitBreaker(
    records: ToolCallRecord[],
  ): LoopDetection | null {
    if (records.length < CIRCUIT_BREAKER_LIMIT) return null;

    const last = records[records.length - 1];
    return {
      type: 'circuit_breaker',
      message: `Circuit breaker: ${records.length} tool calls in this run exceeds the ${CIRCUIT_BREAKER_LIMIT}-call safety limit. Wrap up your current approach.`,
      toolName: last.toolName,
      callCount: records.length,
    };
  }

  private hashArgs(toolName: string, args: Record<string, unknown>): string {
    const payload = JSON.stringify({ t: toolName, a: args });
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }
}
