import { describe, expect, it } from 'vitest';
import {
  WebFetchTool,
  normalizeHeaders,
  stripCredentialHeaders,
} from './web-fetch.tool';

describe('stripCredentialHeaders', () => {
  it('removes Authorization, Cookie, Proxy-Authorization, and WWW-Authenticate', () => {
    const out = stripCredentialHeaders({
      Authorization: 'Bearer secret',
      Cookie: 'session=xyz',
      'Proxy-Authorization': 'Basic abc',
      'WWW-Authenticate': 'Basic realm=test',
      'X-Custom': 'kept',
      Accept: 'application/json',
    });
    expect(out).toEqual({
      'X-Custom': 'kept',
      Accept: 'application/json',
    });
  });

  it('matches credential header names case-insensitively', () => {
    const out = stripCredentialHeaders({
      authorization: 'Bearer 1',
      COOKIE: 'a=b',
      'X-Keep': 'yes',
    });
    expect(out).toEqual({ 'X-Keep': 'yes' });
  });

  it('returns undefined for undefined input', () => {
    expect(stripCredentialHeaders(undefined)).toBeUndefined();
  });

  it('accepts a Headers instance', () => {
    const h = new Headers();
    h.set('Authorization', 'Bearer x');
    h.set('X-Allowed', 'ok');
    const out = stripCredentialHeaders(h);
    // Headers normalizes keys to lowercase.
    expect(out).toEqual({ 'x-allowed': 'ok' });
  });

  it('accepts an array-of-pairs', () => {
    const out = stripCredentialHeaders([
      ['Cookie', 'a=1'],
      ['Accept', 'json'],
    ]);
    expect(out).toEqual({ Accept: 'json' });
  });
});

describe('normalizeHeaders', () => {
  it('returns undefined for undefined', () => {
    expect(normalizeHeaders(undefined)).toBeUndefined();
  });

  it('echoes a plain object', () => {
    expect(normalizeHeaders({ A: '1', B: '2' })).toEqual({ A: '1', B: '2' });
  });
});

describe('WebFetchTool URL validation', () => {
  it('rejects loopback before attempting any network call', async () => {
    const tool = new WebFetchTool();
    const result = await tool.execute(
      { url: 'http://127.0.0.1/secret', method: 'GET', timeoutMs: 1000 },
      { threadID: 't', runID: 'r', agentID: 'a' },
    );
    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/private|blocked|internal/i);
  });

  it('rejects file:// and other non-HTTP protocols', async () => {
    const tool = new WebFetchTool();
    const result = await tool.execute(
      { url: 'file:///etc/passwd', method: 'GET', timeoutMs: 1000 },
      { threadID: 't', runID: 'r', agentID: 'a' },
    );
    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/protocol/i);
  });
});
