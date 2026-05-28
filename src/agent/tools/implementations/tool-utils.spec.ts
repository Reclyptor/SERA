import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildToolEnv } from './tool-utils';

describe('buildToolEnv', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Clear and seed a controlled set of env vars for each test
    for (const k of Object.keys(process.env)) delete process.env[k];
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  });

  it('exposes only HOME, PATH, TMPDIR, LANG from process.env', () => {
    process.env.HOME = '/home/test';
    process.env.PATH = '/usr/bin';
    process.env.TMPDIR = '/tmp';
    process.env.LANG = 'en_US.UTF-8';
    process.env.AUTH_SECRET = 'super-secret';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-leak';
    process.env.MONGODB_URI = 'mongodb://leak:1234@x';

    const env = buildToolEnv();

    expect(env).toEqual({
      HOME: '/home/test',
      PATH: '/usr/bin',
      TMPDIR: '/tmp',
      LANG: 'en_US.UTF-8',
    });
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.MONGODB_URI).toBeUndefined();
  });

  it('omits keys whose values are unset', () => {
    process.env.PATH = '/usr/bin';
    // HOME, TMPDIR, LANG intentionally unset

    const env = buildToolEnv();

    expect(env).toEqual({ PATH: '/usr/bin' });
    expect('HOME' in env).toBe(false);
  });

  it('merges extra vars on top of the allowlist', () => {
    process.env.PATH = '/usr/bin';

    const env = buildToolEnv({
      SERA_BRIDGE_URL: 'http://127.0.0.1:9999',
      SERA_BRIDGE_SECRET: 'token-xyz',
    });

    expect(env).toMatchObject({
      PATH: '/usr/bin',
      SERA_BRIDGE_URL: 'http://127.0.0.1:9999',
      SERA_BRIDGE_SECRET: 'token-xyz',
    });
  });

  it('skips extra vars whose values are undefined', () => {
    process.env.PATH = '/usr/bin';

    const env = buildToolEnv({ SERA_BRIDGE_URL: undefined });

    expect(env).toEqual({ PATH: '/usr/bin' });
  });
});
