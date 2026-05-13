import { Injectable, Logger } from '@nestjs/common';

export type ThreatSeverity = 'low' | 'medium' | 'high';

export interface ThreatMatch {
  category: string;
  severity: ThreatSeverity;
  pattern: string;
  match: string;
}

export interface ScanResult {
  safe: boolean;
  threats: ThreatMatch[];
}

interface ThreatPattern {
  category: string;
  severity: ThreatSeverity;
  regex: RegExp;
  label: string;
}

const THREAT_PATTERNS: ThreatPattern[] = [
  // Prompt injection — attempts to override system instructions
  {
    category: 'prompt_injection',
    severity: 'high',
    regex:
      /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior|earlier)\s+(?:instructions?|prompts?|rules?|directives?)/i,
    label: 'Instruction override attempt',
  },
  {
    category: 'prompt_injection',
    severity: 'high',
    regex:
      /you\s+are\s+now\s+(?:a\s+)?(?:new|different|unrestricted|jailbroken)/i,
    label: 'Role reassignment attempt',
  },
  {
    category: 'prompt_injection',
    severity: 'high',
    regex: /\[?\s*system\s*\]?\s*:\s*you\s+(?:are|must|should|will)/i,
    label: 'Fake system message injection',
  },
  {
    category: 'prompt_injection',
    severity: 'medium',
    regex: /(?:new\s+)?(?:system\s+)?prompt\s*[:=]\s*/i,
    label: 'System prompt override',
  },
  {
    category: 'prompt_injection',
    severity: 'medium',
    regex: /\bDAN\b.{0,50}\bmode\b|\bjailbreak\b/i,
    label: 'Jailbreak keyword',
  },

  // Role hijacking — attempts to change the assistant's identity
  {
    category: 'role_hijack',
    severity: 'high',
    regex:
      /(?:from\s+now\s+on|henceforth)\s+you\s+(?:are|will\s+be|must\s+act\s+as)/i,
    label: 'Persistent role change',
  },
  {
    category: 'role_hijack',
    severity: 'medium',
    regex:
      /(?:act|behave|respond)\s+as\s+(?:if\s+you\s+(?:are|were)|an?\s+(?:evil|unrestricted|unfiltered))/i,
    label: 'Behavioral override',
  },

  // Credential exfiltration — attempts to extract secrets
  {
    category: 'credential_exfil',
    severity: 'high',
    regex:
      /(?:print|output|show|reveal|display|tell\s+me|what\s+is)\s+(?:the\s+)?(?:api[_\s]?key|secret|password|token|credential|private[_\s]?key)/i,
    label: 'Credential extraction request',
  },
  {
    category: 'credential_exfil',
    severity: 'high',
    regex:
      /(?:env|process\.env|os\.environ)\s*[\[.(]\s*['"]?\s*(?:API[_\s]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE[_\s]?KEY|DATABASE[_\s]?URL)/i,
    label: 'Environment variable access',
  },
  {
    category: 'credential_exfil',
    severity: 'medium',
    regex:
      /(?:show|print|reveal|output|return|send)\s+(?:the\s+)?(?:apiKey|apiSecret|dbPassword|privateKey|databaseUrl)\b/i,
    label: 'CamelCase credential extraction',
  },
  {
    category: 'credential_exfil',
    severity: 'medium',
    regex:
      /(?:curl|wget|fetch|axios|http)\s+.{0,200}(?:webhook\.site|requestbin|ngrok|burp|pipedream)/i,
    label: 'Data exfiltration endpoint',
  },

  // Invisible unicode — zero-width chars used to hide instructions
  {
    category: 'invisible_unicode',
    severity: 'high',
    regex: /[\u200B\u200C\u200D\u2060\uFEFF]{3,}/,
    label: 'Suspicious zero-width character sequence',
  },
  {
    category: 'invisible_unicode',
    severity: 'medium',
    regex: /[\u200B\u200C\u200D\u2060\uFEFF]/,
    label: 'Zero-width character detected',
  },
  {
    category: 'invisible_unicode',
    severity: 'high',
    regex: /[\u2066\u2067\u2068\u2069\u202A-\u202E]/,
    label: 'Bidirectional text override character',
  },

  // Code injection via stored content
  {
    category: 'code_injection',
    severity: 'high',
    regex:
      /(?:eval|exec|Function)\s*\(\s*['"`].*(?:require|import|child_process|fs\.|net\.|http\.)/i,
    label: 'Dynamic code execution with dangerous imports',
  },
  {
    category: 'code_injection',
    severity: 'medium',
    regex: /(?:__proto__|constructor\s*\[|prototype\s*\.)/,
    label: 'Prototype pollution attempt',
  },
];

@Injectable()
export class ContentScannerService {
  private readonly logger = new Logger(ContentScannerService.name);

  scan(content: string): ScanResult {
    const threats: ThreatMatch[] = [];

    for (const pattern of THREAT_PATTERNS) {
      const match = content.match(pattern.regex);
      if (match) {
        threats.push({
          category: pattern.category,
          severity: pattern.severity,
          pattern: pattern.label,
          match: match[0].slice(0, 100),
        });
      }
    }

    if (threats.length > 0) {
      const highCount = threats.filter((t) => t.severity === 'high').length;
      this.logger.warn(
        `Content scan found ${threats.length} threat(s) (${highCount} high): ${threats.map((t) => t.pattern).join(', ')}`,
      );
    }

    return {
      safe: !threats.some((t) => t.severity === 'high'),
      threats,
    };
  }

  assertSafe(content: string, context: string): void {
    const result = this.scan(content);
    if (!result.safe) {
      const highThreats = result.threats
        .filter((t) => t.severity === 'high')
        .map((t) => t.pattern);
      throw new ContentThreatError(
        `Content rejected (${context}): ${highThreats.join(', ')}`,
        result.threats,
      );
    }
  }
}

export class ContentThreatError extends Error {
  constructor(
    message: string,
    public readonly threats: ThreatMatch[],
  ) {
    super(message);
    this.name = 'ContentThreatError';
  }
}
