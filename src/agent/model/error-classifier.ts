export enum FailoverReason {
  RateLimit = 'rate_limit',
  QuotaExhausted = 'quota_exhausted',
  ServerError = 'server_error',
  ServiceUnavailable = 'service_unavailable',
  GatewayTimeout = 'gateway_timeout',
  RequestTimeout = 'request_timeout',
  ConnectionRefused = 'connection_refused',
  ConnectionReset = 'connection_reset',
  DNSFailure = 'dns_failure',
  TLSError = 'tls_error',
  ContentFilter = 'content_filter',
  ContextLengthExceeded = 'context_length_exceeded',
  InvalidAuth = 'invalid_auth',
  ModelNotFound = 'model_not_found',
  Aborted = 'aborted',
  Unknown = 'unknown',
}

export interface ClassifiedError {
  reason: FailoverReason;
  retryable: boolean;
  shouldRotate: boolean;
  shouldCompress: boolean;
  message: string;
  status?: number;
}

const STATUS_MAP: Record<number, FailoverReason> = {
  400: FailoverReason.Unknown,
  401: FailoverReason.InvalidAuth,
  403: FailoverReason.InvalidAuth,
  404: FailoverReason.ModelNotFound,
  429: FailoverReason.RateLimit,
  500: FailoverReason.ServerError,
  502: FailoverReason.ServiceUnavailable,
  503: FailoverReason.ServiceUnavailable,
  504: FailoverReason.GatewayTimeout,
};

const MESSAGE_PATTERNS: [RegExp, FailoverReason][] = [
  [/rate.?limit|too many requests|throttl/i, FailoverReason.RateLimit],
  [/quota|billing|insufficient.?funds/i, FailoverReason.QuotaExhausted],
  [/context.?length|token.?limit|too.?long|maximum.?context/i, FailoverReason.ContextLengthExceeded],
  [/content.?filter|safety|moderation|blocked/i, FailoverReason.ContentFilter],
  [/ECONNREFUSED/i, FailoverReason.ConnectionRefused],
  [/ECONNRESET|socket hang up/i, FailoverReason.ConnectionReset],
  [/ENOTFOUND|getaddrinfo/i, FailoverReason.DNSFailure],
  [/ETIMEDOUT|timeout|timed?\s*out/i, FailoverReason.RequestTimeout],
  [/TLS|SSL|certificate/i, FailoverReason.TLSError],
  [/abort/i, FailoverReason.Aborted],
];

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as Record<string, unknown>;
  for (const key of ['status', 'statusCode', 'code']) {
    const val = e[key];
    if (typeof val === 'number' && val >= 100 && val < 600) return val;
  }
  if (e.response && typeof e.response === 'object') {
    const resp = e.response as Record<string, unknown>;
    if (typeof resp.status === 'number') return resp.status;
  }
  return undefined;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function classifyError(error: unknown): ClassifiedError {
  const status = extractStatus(error);
  const message = extractMessage(error);

  let reason = FailoverReason.Unknown;

  if (status && STATUS_MAP[status]) {
    reason = STATUS_MAP[status];
  }

  if (reason === FailoverReason.Unknown) {
    for (const [pattern, match] of MESSAGE_PATTERNS) {
      if (pattern.test(message)) {
        reason = match;
        break;
      }
    }
  }

  // 400 with context length message is a special case
  if (status === 400 && /context.?length|token.?limit|too.?long/i.test(message)) {
    reason = FailoverReason.ContextLengthExceeded;
  }

  return {
    reason,
    retryable: isRetryable(reason),
    shouldRotate: shouldRotateProvider(reason),
    shouldCompress: reason === FailoverReason.ContextLengthExceeded,
    message,
    status,
  };
}

function isRetryable(reason: FailoverReason): boolean {
  switch (reason) {
    case FailoverReason.RateLimit:
    case FailoverReason.ServerError:
    case FailoverReason.ServiceUnavailable:
    case FailoverReason.GatewayTimeout:
    case FailoverReason.RequestTimeout:
    case FailoverReason.ConnectionReset:
      return true;
    default:
      return false;
  }
}

function shouldRotateProvider(reason: FailoverReason): boolean {
  switch (reason) {
    case FailoverReason.RateLimit:
    case FailoverReason.QuotaExhausted:
    case FailoverReason.InvalidAuth:
    case FailoverReason.ModelNotFound:
    case FailoverReason.ServiceUnavailable:
      return true;
    default:
      return false;
  }
}
