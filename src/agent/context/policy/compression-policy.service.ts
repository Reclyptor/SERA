import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_COOLDOWN_MS = 600_000;
const THRASH_HISTORY = 2;
const THRASH_SAVINGS_FLOOR = 0.1;

export interface CompressionPolicyDecision {
  allow: boolean;
  reason?: 'thrash' | 'cooldown';
  detail?: string;
}

@Injectable()
export class CompressionPolicyService {
  private readonly cooldownDeadlines = new Map<string, number>();
  private readonly savingsHistory = new Map<string, number[]>();
  private readonly cooldownMs: number;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>('CONTEXT_COOLDOWN_MS');
    const parsed = raw ? parseInt(raw, 10) : DEFAULT_COOLDOWN_MS;
    this.cooldownMs =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COOLDOWN_MS;
  }

  shouldRun(threadID: string, force: boolean): CompressionPolicyDecision {
    if (force) return { allow: true };

    if (this.isCooldownActive(threadID)) {
      const remainingMs =
        (this.cooldownDeadlines.get(threadID) ?? 0) - Date.now();
      return {
        allow: false,
        reason: 'cooldown',
        detail: `${Math.ceil(remainingMs / 1000)}s remaining`,
      };
    }

    if (this.isThrashing(threadID)) {
      return {
        allow: false,
        reason: 'thrash',
        detail: `Last ${THRASH_HISTORY} summarizations saved <${Math.round(
          THRASH_SAVINGS_FLOOR * 100,
        )}% each`,
      };
    }

    return { allow: true };
  }

  noteSummarization(threadID: string, savingsRatio: number): void {
    const history = this.savingsHistory.get(threadID) ?? [];
    history.push(savingsRatio);
    while (history.length > THRASH_HISTORY) history.shift();
    this.savingsHistory.set(threadID, history);
  }

  noteFailure(threadID: string): void {
    this.cooldownDeadlines.set(threadID, Date.now() + this.cooldownMs);
  }

  reset(threadID: string): void {
    this.cooldownDeadlines.delete(threadID);
    this.savingsHistory.delete(threadID);
  }

  private isCooldownActive(threadID: string): boolean {
    const deadline = this.cooldownDeadlines.get(threadID);
    if (!deadline) return false;
    if (Date.now() >= deadline) {
      this.cooldownDeadlines.delete(threadID);
      return false;
    }
    return true;
  }

  private isThrashing(threadID: string): boolean {
    const history = this.savingsHistory.get(threadID);
    if (!history || history.length < THRASH_HISTORY) return false;
    return history.every((s) => s < THRASH_SAVINGS_FLOOR);
  }
}
