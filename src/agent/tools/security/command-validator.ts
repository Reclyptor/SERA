/**
 * Validate shell commands against a blocklist of dangerous patterns.
 */

const BLOCKED_COMMANDS = [
  /\brm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive).*\//i, // rm -rf /
  /\bmkfs\b/i,
  /\bdd\b\s+.*of=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\bhalt\b/i,
  /\binit\s+0\b/i,
  /\bsystemctl\s+(stop|disable|mask)\b/i,
  /\bchmod\s+777\b/,
  /\bchmod\s+-R\s+777\b/,
  /\bchown\s+-R\s+.*\//i,
  />\s*\/dev\/sd/i,
  />\s*\/dev\/nvme/i,
  /\b:()\s*\{\s*:\|:\s*&\s*\}\s*;/, // Fork bomb
  /\bkillall\b/i,
  /\bpkill\s+-9\b/i,
  /\biptables\s+-F\b/i,
  /\bufw\s+disable\b/i,
  /\bpasswd\b/i,
  /\buseradd\b/i,
  /\buserdel\b/i,
  /\bvisudo\b/i,
  /\bsudo\s+su\b/i,
  /\bcrontab\s+-r\b/i,
];

export interface CommandValidationResult {
  valid: boolean;
  error?: string;
}

export function validateCommand(command: string): CommandValidationResult {
  if (!command?.trim()) {
    return { valid: false, error: 'Command cannot be empty' };
  }

  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      return {
        valid: false,
        error: `Command blocked: matches dangerous pattern "${pattern.source}"`,
      };
    }
  }

  return { valid: true };
}
