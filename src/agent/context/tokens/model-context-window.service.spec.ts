import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  ModelContextWindowService,
  PROVIDER_DEFAULT_WINDOWS,
} from './model-context-window.service';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('ModelContextWindowService', () => {
  it('returns provider defaults when no overrides are configured', () => {
    const service = new ModelContextWindowService(makeConfig({}));
    expect(service.get('anthropic')).toBe(PROVIDER_DEFAULT_WINDOWS.anthropic);
    expect(service.get('openai')).toBe(PROVIDER_DEFAULT_WINDOWS.openai);
    expect(service.get('google')).toBe(PROVIDER_DEFAULT_WINDOWS.google);
    expect(service.get('vllm')).toBe(PROVIDER_DEFAULT_WINDOWS.vllm);
  });

  it('honors per-provider env overrides', () => {
    const service = new ModelContextWindowService(
      makeConfig({ ANTHROPIC_CONTEXT_WINDOW: '50000' }),
    );
    expect(service.get('anthropic')).toBe(50_000);
    expect(service.get('openai')).toBe(PROVIDER_DEFAULT_WINDOWS.openai);
  });

  it('lets per-model overrides win over provider defaults', () => {
    const service = new ModelContextWindowService(
      makeConfig({
        MODEL_CONTEXT_WINDOWS: JSON.stringify({
          'Huihui-Qwen3.6-35B-A3B-Claude-4.7-Opus-abliterated-FP8': 32_768,
        }),
      }),
    );
    expect(
      service.get(
        'vllm',
        'Huihui-Qwen3.6-35B-A3B-Claude-4.7-Opus-abliterated-FP8',
      ),
    ).toBe(32_768);
    expect(service.get('vllm', 'unknown-model')).toBe(
      PROVIDER_DEFAULT_WINDOWS.vllm,
    );
  });

  it('accepts numeric strings in MODEL_CONTEXT_WINDOWS', () => {
    const service = new ModelContextWindowService(
      makeConfig({
        MODEL_CONTEXT_WINDOWS: JSON.stringify({ 'model-a': '65536' }),
      }),
    );
    expect(service.get('vllm', 'model-a')).toBe(65_536);
  });

  it('falls back to provider default when MODEL_CONTEXT_WINDOWS is invalid JSON', () => {
    const service = new ModelContextWindowService(
      makeConfig({ MODEL_CONTEXT_WINDOWS: '{not-json' }),
    );
    expect(service.get('anthropic', 'claude-opus-4-7')).toBe(
      PROVIDER_DEFAULT_WINDOWS.anthropic,
    );
  });

  it('ignores non-positive overrides', () => {
    const service = new ModelContextWindowService(
      makeConfig({
        MODEL_CONTEXT_WINDOWS: JSON.stringify({
          'model-a': 0,
          'model-b': -5,
          'model-c': 'NaN',
        }),
      }),
    );
    expect(service.get('vllm', 'model-a')).toBe(PROVIDER_DEFAULT_WINDOWS.vllm);
    expect(service.get('vllm', 'model-b')).toBe(PROVIDER_DEFAULT_WINDOWS.vllm);
    expect(service.get('vllm', 'model-c')).toBe(PROVIDER_DEFAULT_WINDOWS.vllm);
  });

  it('falls back to 200_000 for entirely unknown providers', () => {
    const service = new ModelContextWindowService(makeConfig({}));
    expect(service.get('mystery-provider')).toBe(200_000);
  });
});
