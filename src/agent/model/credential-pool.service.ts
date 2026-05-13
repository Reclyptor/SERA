import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Strategy = 'round_robin' | 'least_used' | 'random';

interface KeyState {
  key: string;
  usageCount: number;
  cooldownUntil: number;
}

interface ProviderPool {
  keys: KeyState[];
  strategy: Strategy;
  nextIndex: number;
}

const DEFAULT_COOLDOWN_MS = 60_000;

@Injectable()
export class CredentialPoolService {
  private readonly logger = new Logger(CredentialPoolService.name);
  private readonly pools = new Map<string, ProviderPool>();
  private readonly lastUsedKey = new Map<string, string>();
  private readonly cooldownMs: number;

  constructor(private readonly configService: ConfigService) {
    this.cooldownMs =
      parseInt(
        this.configService.get<string>(
          'CREDENTIAL_COOLDOWN_MS',
          String(DEFAULT_COOLDOWN_MS),
        ),
        10,
      ) || DEFAULT_COOLDOWN_MS;

    this.initPool('anthropic', 'ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEYS');
    this.initPool('openai', 'OPENAI_API_KEY', 'OPENAI_API_KEYS');
    this.initPool('google', 'GOOGLE_API_KEY', 'GOOGLE_API_KEYS');
  }

  private initPool(
    provider: string,
    singularEnv: string,
    pluralEnv: string,
  ): void {
    const plural = this.configService.get<string>(pluralEnv, '');
    const singular = this.configService.get<string>(singularEnv, '');

    const keys = plural
      ? plural
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      : singular
        ? [singular]
        : [];

    if (keys.length === 0) return;

    const strategy: Strategy =
      (this.configService.get<string>(
        `${provider.toUpperCase()}_KEY_STRATEGY`,
      ) as Strategy) ?? 'round_robin';

    this.pools.set(provider, {
      keys: keys.map((key) => ({ key, usageCount: 0, cooldownUntil: 0 })),
      strategy,
      nextIndex: 0,
    });

    if (keys.length > 1) {
      this.logger.log(
        `Credential pool for ${provider}: ${keys.length} keys, strategy: ${strategy}`,
      );
    }
  }

  getKey(provider: string): string | null {
    const pool = this.pools.get(provider);
    if (!pool) return null;

    const now = Date.now();
    const available = pool.keys.filter((k) => k.cooldownUntil <= now);
    if (available.length === 0) {
      const soonest = pool.keys.reduce((a, b) =>
        a.cooldownUntil < b.cooldownUntil ? a : b,
      );
      this.logger.warn(
        `All keys for ${provider} are on cooldown, using soonest-available`,
      );
      soonest.usageCount++;
      return soonest.key;
    }

    let selected: KeyState;

    switch (pool.strategy) {
      case 'least_used':
        selected = available.reduce((a, b) =>
          a.usageCount <= b.usageCount ? a : b,
        );
        break;
      case 'random':
        selected = available[Math.floor(Math.random() * available.length)];
        break;
      case 'round_robin':
      default: {
        const allIndices = pool.keys.map((_, i) => i);
        const availableIndices = allIndices.filter(
          (i) => pool.keys[i].cooldownUntil <= now,
        );
        let idx = pool.nextIndex % pool.keys.length;
        while (!availableIndices.includes(idx)) {
          idx = (idx + 1) % pool.keys.length;
        }
        selected = pool.keys[idx];
        pool.nextIndex = (idx + 1) % pool.keys.length;
        break;
      }
    }

    selected.usageCount++;
    this.lastUsedKey.set(provider, selected.key);
    return selected.key;
  }

  markCooldown(provider: string, key?: string): void {
    const pool = this.pools.get(provider);
    if (!pool) return;

    const targetKey = key || this.lastUsedKey.get(provider);
    if (!targetKey) return;

    const state = pool.keys.find((k) => k.key === targetKey);
    if (state) {
      state.cooldownUntil = Date.now() + this.cooldownMs;
      this.logger.debug(
        `Key for ${provider} placed on ${this.cooldownMs}ms cooldown`,
      );
    }
  }

  markUsed(provider: string, key: string): void {
    const pool = this.pools.get(provider);
    if (!pool) return;
    const state = pool.keys.find((k) => k.key === key);
    if (state) state.usageCount++;
  }

  hasPool(provider: string): boolean {
    const pool = this.pools.get(provider);
    return !!pool && pool.keys.length > 1;
  }

  getStats(): Record<
    string,
    { total: number; available: number; strategy: Strategy }
  > {
    const now = Date.now();
    const stats: Record<
      string,
      { total: number; available: number; strategy: Strategy }
    > = {};
    for (const [provider, pool] of this.pools) {
      stats[provider] = {
        total: pool.keys.length,
        available: pool.keys.filter((k) => k.cooldownUntil <= now).length,
        strategy: pool.strategy,
      };
    }
    return stats;
  }
}
