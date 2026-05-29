import { Injectable } from '@nestjs/common';

const REDACTED = '[REDACTED]';

interface Pattern {
  regex: RegExp;
  replacement: string;
}

// Each pattern is intentionally narrow to keep false positives low. Order
// matters when a value could match more than one rule — the more specific
// pattern wins by running first.
const PATTERNS: Pattern[] = [
  // Private key blocks (-----BEGIN ... PRIVATE KEY-----)
  {
    regex:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED PRIVATE KEY]',
  },
  // Anthropic key (sk-ant-...)
  {
    regex: /sk-ant-[A-Za-z0-9_-]{16,}/g,
    replacement: REDACTED,
  },
  // OpenAI / generic sk-... keys
  {
    regex: /\bsk-[A-Za-z0-9_-]{20,}/g,
    replacement: REDACTED,
  },
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  {
    regex: /\bgh[opusr]_[A-Za-z0-9]{30,}/g,
    replacement: REDACTED,
  },
  // AWS access key IDs
  {
    regex: /\bA(KIA|SIA|GPA|ROA|IDA|NPA|IPA)[0-9A-Z]{16}\b/g,
    replacement: REDACTED,
  },
  // Bearer tokens in headers / docs
  {
    regex: /(Bearer\s+)[A-Za-z0-9._\-+/=]{8,}/gi,
    replacement: `$1${REDACTED}`,
  },
  // Connection strings with embedded credentials (postgres://user:pass@…)
  {
    regex:
      /\b(postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/([^\s:/?#@]+):([^\s:/?#@]+)@/gi,
    replacement: `$1://${REDACTED}@`,
  },
];

@Injectable()
export class SecretRedactorService {
  redact(text: string): string {
    if (!text) return text;
    let out = text;
    for (const { regex, replacement } of PATTERNS) {
      out = out.replace(regex, replacement);
    }
    return out;
  }
}
