interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5': {
    inputPerMTok: 0.8,
    outputPerMTok: 4.0,
    cacheReadPerMTok: 0.08,
    cacheWritePerMTok: 1.0,
  },
  'claude-sonnet-4-6': {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
  },
  'claude-opus-4-7': {
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
    cacheReadPerMTok: 1.5,
    cacheWritePerMTok: 18.75,
  },
  'gpt-4o-mini': {
    inputPerMTok: 0.15,
    outputPerMTok: 0.6,
  },
  'gpt-4o': {
    inputPerMTok: 2.5,
    outputPerMTok: 10.0,
  },
  o3: {
    inputPerMTok: 2.0,
    outputPerMTok: 8.0,
  },
  'gemini-2.0-flash': {
    inputPerMTok: 0.1,
    outputPerMTok: 0.4,
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

  return (
    Math.round(
      (inputCost + outputCost + cacheReadCost + cacheWriteCost) * 100,
    ) / 100
  );
}
