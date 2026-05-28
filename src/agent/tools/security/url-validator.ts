import { lookup } from 'dns/promises';
import { isIP } from 'net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254', // Cloud metadata endpoint
  'metadata.google.internal',
]);

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  /**
   * Resolved IP addresses that passed the safety checks. Populated only
   * when validation succeeds and the URL contains a hostname (literal
   * IPs return themselves). Consumers can pin the actual connection to
   * one of these addresses to defeat DNS rebind between validation and
   * the outbound request.
   */
  addresses?: ResolvedAddress[];
}

export async function validateUrl(url: string): Promise<UrlValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      valid: false,
      error: `Protocol "${parsed.protocol}" is not allowed. Use http or https.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    return { valid: false, error: `Access to "${parsed.hostname}" is blocked` };
  }

  const family = isIP(hostname);
  if (family) {
    if (isBlockedIP(hostname)) {
      return {
        valid: false,
        error: 'Access to private/internal IP addresses is blocked',
      };
    }
    return {
      valid: true,
      addresses: [{ address: hostname, family }],
    };
  }

  let records: ResolvedAddress[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'DNS lookup failed',
    };
  }

  for (const record of records) {
    if (isBlockedIP(record.address)) {
      return {
        valid: false,
        error: `Hostname "${hostname}" resolves to a private/internal address`,
      };
    }
  }

  return { valid: true, addresses: records };
}

export function validateUrlSyntax(url: string): UrlValidationResult {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        valid: false,
        error: `Protocol "${parsed.protocol}" is not allowed. Use http or https.`,
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

function isBlockedIP(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;

  const version = isIP(normalized);
  if (normalized.startsWith('::ffff:')) {
    return isBlockedIP(normalized.slice('::ffff:'.length));
  }
  if (version === 4) {
    const parts = normalized.split('.').map((part) => Number(part));
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (version === 6) {
    return (
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('ff') ||
      normalized.startsWith('::ffff:0:') ||
      normalized.startsWith('64:ff9b:')
    );
  }

  return true;
}
