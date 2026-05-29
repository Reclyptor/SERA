import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const PROVIDER_DEFAULT_WINDOWS: Record<string, number> = {
  anthropic: 200_000,
  openai: 128_000,
  google: 1_000_000,
  vllm: 131_072,
};

const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: 'ANTHROPIC_CONTEXT_WINDOW',
  openai: 'OPENAI_CONTEXT_WINDOW',
  google: 'GOOGLE_CONTEXT_WINDOW',
  vllm: 'VLLM_CONTEXT_WINDOW',
};

@Injectable()
export class ModelContextWindowService {
  private readonly logger = new Logger(ModelContextWindowService.name);
  private readonly providerWindows: Record<string, number>;
  private readonly perModelOverrides: Record<string, number>;

  constructor(private readonly configService: ConfigService) {
    this.providerWindows = { ...PROVIDER_DEFAULT_WINDOWS };
    for (const [provider, envVar] of Object.entries(PROVIDER_ENV_VARS)) {
      const raw = this.configService.get<string>(envVar);
      if (!raw) continue;
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        this.providerWindows[provider] = parsed;
      }
    }
    this.perModelOverrides = this.parseModelOverrides();
  }

  get(provider: string, modelID?: string): number {
    if (modelID && this.perModelOverrides[modelID]) {
      return this.perModelOverrides[modelID];
    }
    return this.providerWindows[provider] ?? 200_000;
  }

  private parseModelOverrides(): Record<string, number> {
    const raw = this.configService.get<string>('MODEL_CONTEXT_WINDOWS');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed == null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        this.logger.warn(
          'MODEL_CONTEXT_WINDOWS is not a JSON object; ignoring overrides',
        );
        return {};
      }
      const result: Record<string, number> = {};
      for (const [model, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          result[model] = value;
          continue;
        }
        if (typeof value === 'string') {
          const n = parseInt(value, 10);
          if (Number.isFinite(n) && n > 0) {
            result[model] = n;
            continue;
          }
        }
        this.logger.warn(
          `MODEL_CONTEXT_WINDOWS entry "${model}" is not a positive number; ignored`,
        );
      }
      return result;
    } catch (err) {
      this.logger.warn(
        `MODEL_CONTEXT_WINDOWS is not valid JSON; ignoring overrides: ${(err as Error).message}`,
      );
      return {};
    }
  }
}
