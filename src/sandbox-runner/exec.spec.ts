import { describe, it, expect } from 'vitest';
import { buildWrappedCommand, buildEnv, shellQuote } from './exec';

const NO_NS = { pid: false, net: false };
const ALL_NS = { pid: true, net: true };

describe('shellQuote', () => {
  it('wraps in single quotes', () => {
    expect(shellQuote('echo hi')).toBe("'echo hi'");
  });

  it('escapes embedded single quotes so the wrapper cannot be broken out of', () => {
    expect(shellQuote("echo 'hi'")).toBe("'echo '\\''hi'\\'''");
  });
});

describe('buildWrappedCommand', () => {
  it('applies ulimits and execs the command when no namespaces are available', () => {
    const out = buildWrappedCommand('echo hi', 256, 30_000, false, NO_NS);
    expect(out).toContain('ulimit -v 262144');
    expect(out).toContain('ulimit -t 30');
    expect(out).toContain('exec echo hi');
    expect(out).not.toContain('unshare');
  });

  it('wraps in unshare when pid namespaces are available', () => {
    const out = buildWrappedCommand('echo hi', 256, 30_000, false, ALL_NS);
    expect(out.startsWith('unshare ')).toBe(true);
    expect(out).toContain('--pid');
    expect(out).toContain('--fork');
  });

  // --net removes network access, so it must appear only when the caller did
  // NOT ask for networking. Inverting this silently grants the network.
  it('adds --net only when networking is disabled', () => {
    const off = buildWrappedCommand('echo hi', 256, 30_000, false, ALL_NS);
    const on = buildWrappedCommand('echo hi', 256, 30_000, true, ALL_NS);
    expect(off).toContain('--net');
    expect(on).not.toContain('--net');
  });

  it('rounds sub-second timeouts up to a whole ulimit second', () => {
    expect(buildWrappedCommand('x', 1, 1500, false, NO_NS)).toContain(
      'ulimit -t 2',
    );
  });
});

describe('buildEnv', () => {
  it('returns only the fixed set plus explicit extras', () => {
    const env = buildEnv('/workspace');
    expect(Object.keys(env).sort()).toEqual(['HOME', 'LANG', 'PATH', 'TMPDIR']);
  });

  it('does not inherit the runner process environment', () => {
    process.env.SANDBOX_SPEC_CANARY = 'leaked';
    try {
      expect(buildEnv('/workspace')).not.toHaveProperty('SANDBOX_SPEC_CANARY');
    } finally {
      delete process.env.SANDBOX_SPEC_CANARY;
    }
  });

  it('merges caller-supplied variables', () => {
    expect(buildEnv('/workspace', { FOO: 'bar' }).FOO).toBe('bar');
  });
});
