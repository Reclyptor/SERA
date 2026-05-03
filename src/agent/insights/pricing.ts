interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5': {
    inputPerMTok: 0.80,
    outputPerMTok: 4.00,
    cacheReadPerMTok: 0.08,
    cacheWritePerMTok: 1.00,
  },
  'claude-sonnet-4-6': {
    inputPerMTok: 3.00,
    outputPerMTok: 15.00,
    cacheReadPerMTok: 0.30,
    cacheWritePerMTok: 3.75,
  },
  'claude-opus-4-7': {
    inputPerMTok: 15.00,
    outputPerMTok: 75.00,
    cacheReadPerMTok: 1.50,
    cacheWritePerMTok: 18.75,
  },
  'gpt-4o-mini': {
    inputPerMTok: 0.15,
    outputPerMTok: 0.60,
  },
  'gpt-4o': {
    inputPerMTok: 2.50,
    outputPerMTok: 10.00,
  },
  'o3': {
    inputPerMTok: 2.00,
    outputPerMTok: 8.00,
  },
  'gemini-2.0-flash': {
    inputPerMTok: 0.10,
    outputPerMTok: 0.40,
  },
};

export function calculateCost(
  modelID: string,
  tokens: {
    input: number;
    output: number;
    thinking?: number;
    cacheRead?: number;
    cacheWrite?: number;
  },
): number {
  const pricing = PRICING[modelID];
  if (!pricing) return 0;

  const inputTokens = tokens.input + (tokens.thinking ?? 0);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMTok;
  const outputCost = (tokens.output / 1_000_000) * pricing.outputPerMTok;

  const cacheReadCost = pricing.cacheReadPerMTok
    ? ((tokens.cacheRead ?? 0) / 1_000_000) * pricing.cacheReadPerMTok
    : 0;
  const cacheWriteCost = pricing.cacheWritePerMTok
    ? ((tokens.cacheWrite ?? 0) / 1_000_000) * pricing.cacheWritePerMTok
    : 0;

  return Math.round((inputCost + outputCost + cacheReadCost + cacheWriteCost) * 100) / 100;
}
