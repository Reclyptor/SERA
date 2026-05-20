import { ExecTool } from './exec.tool';

describe('ExecTool', () => {
  it('honors an already-aborted execution context', async () => {
    const controller = new AbortController();
    controller.abort();
    const tool = new ExecTool(process.cwd(), true);

    await expect(
      tool.execute(
        { command: 'pwd', timeoutMs: 1000 },
        {
          threadID: 'thread-1',
          runID: 'run-1',
          agentID: 'agent-1',
          abortSignal: controller.signal,
        },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: 'Command cancelled',
    });
  });
});
