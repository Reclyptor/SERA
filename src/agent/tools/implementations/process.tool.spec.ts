import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessTool } from './process.tool';

// Access the static `processes` map directly to seed cross-thread state
// without spawning real child processes.
const processesMap = (
  ProcessTool as unknown as { processes: Map<string, unknown> }
).processes;

function seedTrackedProcess(
  processID: string,
  threadID: string,
  agentID = 'agent-x',
) {
  processesMap.set(processID, {
    child: { pid: 1234, kill: vi.fn() },
    stdout: 'OUTPUT',
    stderr: '',
    exitCode: null,
    startedAt: new Date(),
    command: 'sleep 60',
    notifyOnComplete: false,
    agentID,
    threadID,
    userID: 'user-x',
  });
}

function makeContext(threadID: string): {
  threadID: string;
  runID: string;
  agentID: string;
} {
  return { threadID, runID: 'run-1', agentID: 'agent-x' };
}

describe('ProcessTool cross-thread isolation', () => {
  beforeEach(() => {
    processesMap.clear();
  });
  afterEach(() => {
    processesMap.clear();
  });

  it('list returns only processes that belong to the requesting thread', async () => {
    seedTrackedProcess('proc-a', 'thread-a');
    seedTrackedProcess('proc-b', 'thread-b');

    const tool = new ProcessTool('/tmp', true);

    const resultA = await tool.execute(
      { operation: 'list' },
      makeContext('thread-a'),
    );
    const resultB = await tool.execute(
      { operation: 'list' },
      makeContext('thread-b'),
    );

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
    const aEntries = resultA.result as Array<{ processID: string }>;
    const bEntries = resultB.result as Array<{ processID: string }>;
    expect(aEntries.map((e) => e.processID)).toEqual(['proc-a']);
    expect(bEntries.map((e) => e.processID)).toEqual(['proc-b']);
  });

  it('output refuses to read another thread’s process', async () => {
    seedTrackedProcess('proc-a', 'thread-a');

    const tool = new ProcessTool('/tmp', true);
    const result = await tool.execute(
      { operation: 'output', processID: 'proc-a' },
      makeContext('thread-b'),
    );

    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/not found/i);
  });

  it('output returns content for the owning thread', async () => {
    seedTrackedProcess('proc-a', 'thread-a');

    const tool = new ProcessTool('/tmp', true);
    const result = await tool.execute(
      { operation: 'output', processID: 'proc-a' },
      makeContext('thread-a'),
    );

    expect(result.success).toBe(true);
    expect((result.result as { stdout: string }).stdout).toBe('OUTPUT');
  });

  it('kill refuses to terminate another thread’s process', async () => {
    seedTrackedProcess('proc-a', 'thread-a');

    const tool = new ProcessTool('/tmp', true);
    const result = await tool.execute(
      { operation: 'kill', processID: 'proc-a' },
      makeContext('thread-b'),
    );

    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/not found/i);
    const tracked = processesMap.get('proc-a') as {
      child: { kill: ReturnType<typeof vi.fn> };
    };
    expect(tracked.child.kill).not.toHaveBeenCalled();
  });

  it('kill terminates a process owned by the requesting thread', async () => {
    seedTrackedProcess('proc-a', 'thread-a');

    const tool = new ProcessTool('/tmp', true);
    const result = await tool.execute(
      { operation: 'kill', processID: 'proc-a' },
      makeContext('thread-a'),
    );

    expect(result.success).toBe(true);
    const tracked = processesMap.get('proc-a') as {
      child: { kill: ReturnType<typeof vi.fn> };
    };
    expect(tracked.child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('output uses the same error shape for unknown and cross-thread IDs', async () => {
    seedTrackedProcess('proc-a', 'thread-a');

    const tool = new ProcessTool('/tmp', true);
    const unknown = await tool.execute(
      { operation: 'output', processID: 'proc-unknown' },
      makeContext('thread-a'),
    );
    const otherThread = await tool.execute(
      { operation: 'output', processID: 'proc-a' },
      makeContext('thread-b'),
    );

    // Both surface a generic "not found" error containing only the input
    // processID — neither leaks the existence of the cross-thread record.
    expect(unknown.success).toBe(false);
    expect(otherThread.success).toBe(false);
    expect(unknown.error).toMatch(/^Process .+ not found$/);
    expect(otherThread.error).toMatch(/^Process .+ not found$/);
  });
});
