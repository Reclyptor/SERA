import { describe, expect, it } from 'vitest';
import { BrowserTool } from './browser.tool';

// These tests verify that navigate() rejects SSRF-blocked URLs BEFORE
// puppeteer is launched. They do not require puppeteer to be installed.

const context = {
  threadID: 'thread-1',
  runID: 'run-1',
  agentID: 'agent-1',
};

describe('BrowserTool.navigate URL validation', () => {
  it('rejects loopback IPv4 literals', async () => {
    const tool = new BrowserTool();
    const result = await tool.execute(
      { action: 'navigate', url: 'http://127.0.0.1/status' },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/private|internal|blocked/i);
  });

  it('rejects RFC1918 private IPs', async () => {
    const tool = new BrowserTool();
    const result = await tool.execute(
      { action: 'navigate', url: 'http://10.0.0.5/admin' },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/private|internal|blocked/i);
  });

  it('rejects the cloud metadata endpoint by literal IP', async () => {
    const tool = new BrowserTool();
    const result = await tool.execute(
      {
        action: 'navigate',
        url: 'http://169.254.169.254/latest/meta-data',
      },
      context,
    );
    expect(result.success).toBe(false);
  });

  it('rejects the cloud metadata endpoint by hostname', async () => {
    const tool = new BrowserTool();
    const result = await tool.execute(
      {
        action: 'navigate',
        url: 'http://metadata.google.internal/',
      },
      context,
    );
    expect(result.success).toBe(false);
  });

  it('rejects non-http(s) protocols', async () => {
    const tool = new BrowserTool();
    const result = await tool.execute(
      { action: 'navigate', url: 'file:///etc/passwd' },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/protocol/i);
  });

  it('rejects requests with no URL', async () => {
    const tool = new BrowserTool();
    const result = await tool.execute({ action: 'navigate' }, context);
    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/required/i);
  });
});
