import { describe, expect, it } from 'vitest';
import { SecretRedactorService } from './secret-redactor.service';

describe('SecretRedactorService', () => {
  const service = new SecretRedactorService();

  it('passes through clean text', () => {
    const out = service.redact('hello world, nothing to redact here');
    expect(out).toBe('hello world, nothing to redact here');
  });

  it('redacts Anthropic keys', () => {
    const out = service.redact(
      'My key is sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF and more text',
    );
    expect(out).not.toContain('sk-ant-api03');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts OpenAI-style sk- keys', () => {
    const out = service.redact(
      'export OPENAI_API_KEY=sk-proj-abc1234567890XYZdef987654321ghi',
    );
    expect(out).not.toContain('sk-proj-abc1234567890XYZdef987654321ghi');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts GitHub personal access tokens', () => {
    const out = service.redact(
      'GITHUB_PAT=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    );
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('ghp_AAAAAAAA');
  });

  it('redacts AWS access keys', () => {
    const out = service.redact('Access key: AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts bearer tokens while preserving the scheme', () => {
    const out = service.redact(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
    );
    expect(out).toContain('Bearer [REDACTED]');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('redacts Postgres connection strings', () => {
    const out = service.redact(
      'DATABASE_URL=postgres://app:s3cr3t@db.internal:5432/prod',
    );
    expect(out).toContain('postgres://[REDACTED]@db.internal:5432/prod');
    expect(out).not.toContain('s3cr3t');
    expect(out).not.toContain('app:s3cr3t');
  });

  it('redacts MongoDB SRV connection strings', () => {
    const out = service.redact(
      'mongodb+srv://user:hunter2@cluster0.example.net/?retryWrites=true',
    );
    expect(out).toContain('mongodb+srv://[REDACTED]@cluster0.example.net');
    expect(out).not.toContain('hunter2');
  });

  it('redacts private key blocks', () => {
    const block =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAxyz...\n-----END RSA PRIVATE KEY-----';
    const out = service.redact(`leak follows: ${block} end`);
    expect(out).toContain('[REDACTED PRIVATE KEY]');
    expect(out).not.toContain('MIIEpAIBAAKCAQEAxyz');
  });

  it('redacts multiple secrets in one document', () => {
    const text = `
      AWS_KEY=AKIAIOSFODNN7EXAMPLE
      ANTHROPIC=sk-ant-api03-VALUE-ZZZZZZZZZZZZZZZZZZ
      DB=postgres://u:p@host/db
    `;
    const out = service.redact(text);
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).not.toContain('sk-ant-api03-VALUE');
    expect(out).not.toContain('u:p@host');
  });
});
