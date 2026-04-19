import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  Connection,
  WorkflowHandle,
  WorkflowExecutionAlreadyStartedError,
} from '@temporalio/client';
import type {
  OrganizeLibraryInput,
  OrganizeLibraryResult,
  OrganizeLibraryProgress,
  FinalizeDecision,
  ReviewDecision,
  DetectionConfirmation,
  FileTreeNode,
  SandboxExecInput,
  SandboxExecResult,
} from './temporal.types';

@Injectable()
export class TemporalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalService.name);
  private client!: Client;
  private connection!: Connection;
  private readonly taskQueue: string;

  constructor(private readonly configService: ConfigService) {
    this.taskQueue = this.configService.get<string>(
      'TEMPORAL_TASK_QUEUE',
      'SERA',
    );
  }

  async onModuleInit() {
    const address = this.configService.get<string>(
      'TEMPORAL_ADDRESS',
      'temporal.temporal.svc.cluster.local:7233',
    );

    const namespace = this.configService.get<string>(
      'TEMPORAL_NAMESPACE',
      'default',
    );

    try {
      this.connection = await Connection.connect({ address });
      this.client = new Client({ connection: this.connection, namespace });
      this.logger.log(`Connected to Temporal at ${address} (ns: ${namespace})`);
    } catch (error) {
      this.logger.warn(
        `Temporal unavailable at ${address} — workflow features disabled: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private ensureConnected(): void {
    if (!this.client) {
      throw new Error('Temporal is not connected');
    }
  }

  async onModuleDestroy() {
    await this.connection?.close();
  }

  // ── Workflow: organizeLibrary ──

  async startOrganizeLibrary(
    input: OrganizeLibraryInput,
    workflowID?: string,
  ): Promise<{ workflowID: string; runID: string }> {
    this.ensureConnected();
    const id = workflowID ?? `organize-${Date.now()}`;

    try {
      const handle = await this.client.workflow.start('organizeLibrary', {
        taskQueue: this.taskQueue,
        workflowId: id,
        args: [input],
      });

      this.logger.log(`Started organizeLibrary workflow: ${id}`);
      return { workflowID: id, runID: handle.firstExecutionRunId };
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        this.logger.warn(`Workflow ${id} already running`);
        const handle = this.client.workflow.getHandle(id);
        const desc = await handle.describe();
        return { workflowID: id, runID: desc.runId };
      }
      throw error;
    }
  }

  async getOrganizeProgress(
    workflowID: string,
  ): Promise<OrganizeLibraryProgress> {
    this.ensureConnected();
    const handle = this.client.workflow.getHandle(workflowID);
    return handle.query<OrganizeLibraryProgress>('getProgress');
  }

  async getOrganizeResult(workflowID: string): Promise<OrganizeLibraryResult> {
    this.ensureConnected();
    const handle = this.client.workflow.getHandle(workflowID);
    return handle.result();
  }

  async getStagingTree(workflowID: string): Promise<FileTreeNode[]> {
    this.ensureConnected();
    const handle = this.client.workflow.getHandle(workflowID);
    return handle.query<FileTreeNode[]>('getStagingTree');
  }

  async finalize(
    workflowID: string,
    decision: FinalizeDecision,
  ): Promise<void> {
    this.ensureConnected();
    const handle = this.client.workflow.getHandle(workflowID);
    await handle.signal('finalize', decision);
    this.logger.log(
      `Sent finalize signal to ${workflowID}: ${decision.approved ? 'approved' : 'rejected'}`,
    );
  }

  // ── Workflow: processFolder (child workflow signals) ──

  async sendReviewDecision(
    workflowID: string,
    decision: ReviewDecision,
  ): Promise<void> {
    this.ensureConnected();
    const handle = this.client.workflow.getHandle(workflowID);
    await handle.signal('reviewDecision', decision);
    this.logger.debug(
      `Sent review decision to ${workflowID}: ${decision.reviewItemID}`,
    );
  }

  async sendDetectionConfirmation(
    workflowID: string,
    confirmation: DetectionConfirmation,
  ): Promise<void> {
    this.ensureConnected();
    const handle = this.client.workflow.getHandle(workflowID);
    await handle.signal('detectionConfirmation', confirmation);
    this.logger.debug(
      `Sent detection confirmation to ${workflowID}: ${confirmation.confirmed}`,
    );
  }

  // ── Workflow: listSeriesRoots ──

  async listSeriesRoots(): Promise<Array<{ name: string; path: string }>> {
    this.ensureConnected();
    const id = `list-roots-${Date.now()}`;
    const handle = await this.client.workflow.start('listSeriesRootsWorkflow', {
      taskQueue: this.taskQueue,
      workflowId: id,
      args: [],
    });

    return handle.result();
  }

  // ── Workflow: sandboxExec ──

  async sandboxExec(input: SandboxExecInput): Promise<SandboxExecResult> {
    this.ensureConnected();
    const id = `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const handle = await this.client.workflow.start('sandboxExecWorkflow', {
      taskQueue: this.taskQueue,
      workflowId: id,
      args: [input],
      workflowExecutionTimeout: '10 minutes',
    });

    return handle.result();
  }

  // ── Generic utilities ──

  async cancelWorkflow(workflowID: string): Promise<void> {
    this.ensureConnected();
    const handle = this.client.workflow.getHandle(workflowID);
    await handle.cancel();
    this.logger.log(`Cancelled workflow: ${workflowID}`);
  }

  async getWorkflowStatus(
    workflowID: string,
  ): Promise<{ status: string; runID: string }> {
    this.ensureConnected();
    const handle = this.client.workflow.getHandle(workflowID);
    const desc = await handle.describe();
    return {
      status: desc.status.name,
      runID: desc.runId,
    };
  }

  getHandle(workflowID: string): WorkflowHandle {
    this.ensureConnected();
    return this.client.workflow.getHandle(workflowID);
  }
}
