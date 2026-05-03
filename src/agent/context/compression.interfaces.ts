export interface StructuredSummary {
  resolved: string[];
  pending: string[];
  activeTask: string | null;
  keyContext: string[];
}

export interface CompressionResult {
  messages: import('ai').ModelMessage[];
  tier: 'none' | 'prune' | 'summarize';
  tokensBefore: number;
  tokensAfter: number;
}
