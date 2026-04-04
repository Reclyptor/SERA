/**
 * Validate URLs to prevent SSRF attacks.
 * Blocks private IP ranges, metadata endpoints, and localhost.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254', // Cloud metadata endpoint
  'metadata.google.internal',
]);

const PRIVATE_IP_PATTERNS = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^127\./, // 127.0.0.0/8
  /^169\.254\./, // 169.254.0.0/16
  /^0\./, // 0.0.0.0/8
  /^\[::1\]/, // IPv6 loopback
  /^\[fc/i, // IPv6 private
  /^\[fd/i, // IPv6 private
  /^\[fe80:/i, // IPv6 link-local
];

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
}

export function validateUrl(url: string): UrlValidationResult {
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

  // Block known hostnames
  if (BLOCKED_HOSTNAMES.has(parsed.hostname)) {
    return { valid: false, error: `Access to "${parsed.hostname}" is blocked` };
  }

  // Block private IP ranges
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(parsed.hostname)) {
      return {
        valid: false,
        error: 'Access to private/internal IP addresses is blocked',
      };
    }
  }

  return { valid: true };
}
