export class CreateModelDto {
  spec!: string;
  provider!: string;
  modelID!: string;
  displayName!: string;
  enabled?: boolean;
  contextWindow?: number;
  inputCostCentsPerMTok?: number;
  outputCostCentsPerMTok?: number;
  cacheReadCostCentsPerMTok?: number;
  cacheWriteCostCentsPerMTok?: number;
  metadata?: Record<string, unknown>;
}

export class UpdateModelDto {
  displayName?: string;
  enabled?: boolean;
  contextWindow?: number;
  inputCostCentsPerMTok?: number;
  outputCostCentsPerMTok?: number;
  cacheReadCostCentsPerMTok?: number;
  cacheWriteCostCentsPerMTok?: number;
  metadata?: Record<string, unknown>;
}
