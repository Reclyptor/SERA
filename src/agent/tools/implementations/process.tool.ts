import { z } from 'zod';
import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { validateCommand } from '../security/command-validator';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolResource,
} from '../tool.interface';
import { resolveWorkspace, truncateOutput, disabledError } from './tool-utils';
import type { ToolApprovalRequester } from './exec.tool';

export interface ProcessOrchestratorLike {
  executeGoal(
    goal: {
      threadID: string;
      runID: string;
      userID: string;
      agentID: string;
      userMessage: string;
      conversationHistory: unknown[];
      isHeartbeat?: boolean;
    },
    config?: {
      maxSteps?: number;
      maxIterations?: number;
      wallClockTimeoutMs?: number;
    },
  ): Promise<void>;
}

const MAX_OUTPUT_SIZE = 64 * 1024;

interface TrackedProcess {
  child: ChildProcess;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: Date;
  command: string;
  notifyOnComplete: boolean;
  agentID: string;
  threadID: string;
  userID: string;
}

const parameters = z.object({
  operation: z
    .enum(['start', 'list', 'output', 'kill'])
    .describe('Operation to perform'),
  command: z
    .string()
    .optional()
    .describe('Command to start (required for start)'),
  processID: z
    .string()
    .optional()
    .describe('Process ID (required for output/kill)'),
  notifyOnComplete: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, starts a new agent run with the process output when the process exits',
    ),
});

export class ProcessTool implements Tool<typeof parameters> {
  readonly name = 'process';
  readonly description =
    'Manage background processes. Start long-running commands, list active processes, get output, or kill them.';
  readonly parameters = parameters;

  // Shared across all tool instances — mutations serialized via registry mutex
  private static readonly processes = new Map<string, TrackedProcess>();

  constructor(
    private readonly workspaceDir: string,
    private readonly enabled: boolean = false,
    private readonly orchestratorResolver?: () => ProcessOrchestratorLike,
    private readonly approvalRequester?: ToolApprovalRequester,
  ) {}

  getResources(): ToolResource[] {
    return [{ type: 'process' }];
  }

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    switch (args.operation) {
      case 'start':
        return this.start(args, context);
      case 'list':
        return this.list();
      case 'output':
        return this.output(args.processID);
      case 'kill':
        return this.kill(args.processID);
    }
  }

  private async start(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.enabled) {
      return disabledError('Shell execution', 'ENABLE_SHELL_TOOL');
    }

    const command = args.command;
    if (!command) {
      return { success: false, error: 'Command is required for start' };
    }

    const validation = validateCommand(command);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    if (validation.action === 'approval_required') {
      if (!this.approvalRequester) {
        return {
          success: false,
          error:
            'Command requires approval, but approval handling is unavailable',
        };
      }
      const approval = await this.approvalRequester.requestApproval({
        threadID: context.threadID,
        runID: context.runID,
        actionName: this.name,
        args: {
          operation: args.operation,
          command,
          notifyOnComplete: args.notifyOnComplete,
        },
        message: `Approval required to start background process: ${command}`,
      });
      return {
        success: false,
        result: { status: 'approval_required', ...approval },
        error: `Command requires approval (${approval.confirmationID})`,
      };
    }
    if (context.abortSignal?.aborted) {
      return { success: false, error: 'Process start cancelled' };
    }

    const processID = randomUUID();
    const child = spawn(command, {
      shell: true,
      cwd: resolveWorkspace(context, this.workspaceDir),
      env: { ...process.env, PATH: process.env.PATH },
    });

    const tracked: TrackedProcess = {
      child,
      stdout: '',
      stderr: '',
      exitCode: null,
      startedAt: new Date(),
      command,
      notifyOnComplete: args.notifyOnComplete ?? false,
      agentID: context.agentID,
      threadID: context.threadID,
      userID: context.userID ?? '',
    };

    child.stdout?.on('data', (data: Buffer) => {
      if (tracked.stdout.length < MAX_OUTPUT_SIZE) {
        tracked.stdout += data.toString();
        tracked.stdout = truncateOutput(tracked.stdout, MAX_OUTPUT_SIZE);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      if (tracked.stderr.length < MAX_OUTPUT_SIZE) {
        tracked.stderr += data.toString();
        tracked.stderr = truncateOutput(tracked.stderr, MAX_OUTPUT_SIZE);
      }
    });

    child.on('exit', (code) => {
      tracked.exitCode = code;
      setTimeout(
        () => ProcessTool.processes.delete(processID),
        5 * 60_000,
      ).unref();

      if (tracked.notifyOnComplete && this.orchestratorResolver) {
        const output = [
          `Process ${processID} exited with code ${code}`,
          tracked.stdout
            ? `\n## stdout\n\`\`\`\n${tracked.stdout}\n\`\`\``
            : '',
          tracked.stderr
            ? `\n## stderr\n\`\`\`\n${tracked.stderr}\n\`\`\``
            : '',
        ].join('');

        this.orchestratorResolver()
          .executeGoal(
            {
              threadID: randomUUID(),
              runID: randomUUID(),
              userID: tracked.userID,
              agentID: tracked.agentID,
              userMessage: `[Background process completed]\n${output}`,
              conversationHistory: [],
              isHeartbeat: true,
            },
            { maxSteps: 10, maxIterations: 2, wallClockTimeoutMs: 180_000 },
          )
          .catch(() => {});
      }
    });

    ProcessTool.processes.set(processID, tracked);

    return {
      success: true,
      result: {
        processID,
        pid: child.pid,
        command,
      },
    };
  }

  private async list(): Promise<ToolExecutionResult> {
    const entries = Array.from(ProcessTool.processes.entries()).map(
      ([processID, tracked]) => ({
        processID,
        pid: tracked.child.pid,
        command: tracked.command,
        running: tracked.exitCode === null,
        startedAt: tracked.startedAt,
      }),
    );

    return { success: true, result: entries };
  }

  private async output(processID?: string): Promise<ToolExecutionResult> {
    if (!processID) {
      return { success: false, error: 'processID is required for output' };
    }

    const tracked = ProcessTool.processes.get(processID);
    if (!tracked) {
      return { success: false, error: `Process ${processID} not found` };
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

  private async kill(processID?: string): Promise<ToolExecutionResult> {
    if (!this.enabled) {
      return disabledError('Shell execution', 'ENABLE_SHELL_TOOL');
    }

    if (!processID) {
      return { success: false, error: 'processID is required for kill' };
    }

    const tracked = ProcessTool.processes.get(processID);
    if (!tracked) {
      return { success: false, error: `Process ${processID} not found` };
    }

    tracked.child.kill('SIGTERM');

    return { success: true, result: { killed: true } };
  }
}
