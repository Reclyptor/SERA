import { z } from 'zod';
import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { validateCommand } from '../security/command-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const MAX_OUTPUT_SIZE = 64 * 1024;

interface TrackedProcess {
  child: ChildProcess;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: Date;
  command: string;
}

const parameters = z.object({
  operation: z
    .enum(['start', 'list', 'output', 'kill'])
    .describe('Operation to perform'),
  command: z
    .string()
    .optional()
    .describe('Command to start (required for start)'),
  processId: z
    .string()
    .optional()
    .describe('Process ID (required for output/kill)'),
});

export class ProcessTool implements Tool<typeof parameters> {
  readonly name = 'process';
  readonly description =
    'Manage background processes. Start long-running commands, list active processes, get output, or kill them.';
  readonly parameters = parameters;

  private static readonly processes = new Map<string, TrackedProcess>();

  constructor(
    private readonly workspaceDir: string,
    private readonly enabled: boolean = false,
  ) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    switch (args.operation) {
      case 'start':
        return this.start(args.command);
      case 'list':
        return this.list();
      case 'output':
        return this.output(args.processId);
      case 'kill':
        return this.kill(args.processId);
    }
  }

  private async start(command?: string): Promise<ToolExecutionResult> {
    if (!this.enabled) {
      return {
        success: false,
        error:
          'Shell execution is disabled. Set ENABLE_SHELL_TOOL=true to enable.',
      };
    }

    if (!command) {
      return { success: false, error: 'Command is required for start' };
    }

    const validation = validateCommand(command);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const processId = randomUUID();
    const child = spawn(command, {
      shell: true,
      cwd: this.workspaceDir,
      env: { ...process.env, PATH: process.env.PATH },
    });

    const tracked: TrackedProcess = {
      child,
      stdout: '',
      stderr: '',
      exitCode: null,
      startedAt: new Date(),
      command,
    };

    child.stdout?.on('data', (data: Buffer) => {
      if (tracked.stdout.length < MAX_OUTPUT_SIZE) {
        tracked.stdout += data.toString();
        if (tracked.stdout.length > MAX_OUTPUT_SIZE) {
          tracked.stdout =
            tracked.stdout.slice(0, MAX_OUTPUT_SIZE) + '\n[...truncated]';
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      if (tracked.stderr.length < MAX_OUTPUT_SIZE) {
        tracked.stderr += data.toString();
        if (tracked.stderr.length > MAX_OUTPUT_SIZE) {
          tracked.stderr =
            tracked.stderr.slice(0, MAX_OUTPUT_SIZE) + '\n[...truncated]';
        }
      }
    });

    child.on('exit', (code) => {
      tracked.exitCode = code;
    });

    ProcessTool.processes.set(processId, tracked);

    return {
      success: true,
      result: {
        processId,
        pid: child.pid,
        command,
      },
    };
  }

  private async list(): Promise<ToolExecutionResult> {
    const entries = Array.from(ProcessTool.processes.entries()).map(
      ([processId, tracked]) => ({
        processId,
        pid: tracked.child.pid,
        command: tracked.command,
        running: tracked.exitCode === null,
        startedAt: tracked.startedAt,
      }),
    );

    return { success: true, result: entries };
  }

  private async output(processId?: string): Promise<ToolExecutionResult> {
    if (!processId) {
      return { success: false, error: 'processId is required for output' };
    }

    const tracked = ProcessTool.processes.get(processId);
    if (!tracked) {
      return { success: false, error: `Process ${processId} not found` };
    }

    return {
      success: true,
      result: {
        stdout: tracked.stdout,
        stderr: tracked.stderr,
        exitCode: tracked.exitCode,
        running: tracked.exitCode === null,
      },
    };
  }

  private async kill(processId?: string): Promise<ToolExecutionResult> {
    if (!this.enabled) {
      return {
        success: false,
        error:
          'Shell execution is disabled. Set ENABLE_SHELL_TOOL=true to enable.',
      };
    }

    if (!processId) {
      return { success: false, error: 'processId is required for kill' };
    }

    const tracked = ProcessTool.processes.get(processId);
    if (!tracked) {
      return { success: false, error: `Process ${processId} not found` };
    }

    tracked.child.kill('SIGTERM');

    return { success: true, result: { killed: true } };
  }
}
