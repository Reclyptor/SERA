export type LoopType =
  | 'exact_repeat'
  | 'ping_pong'
  | 'no_progress'
  | 'circuit_breaker';

export interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  error?: string;
  timestamp: number;
}

export interface LoopDetection {
  type: LoopType;
  message: string;
  toolName: string;
  callCount: number;
}
