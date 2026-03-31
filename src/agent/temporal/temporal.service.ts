import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
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

    this.connection = await Connection.connect({ address });
    this.client = new Client({ connection: this.connection, namespace });
    this.logger.log(`Connected to Temporal at ${address} (ns: ${namespace})`);
  }

  async onModuleDestroy() {
    await this.connection?.close();
  }

  // ── Workflow: organizeLibrary ──

  async startOrganizeLibrary(
    input: OrganizeLibraryInput,
    workflowId?: string,
  ): Promise<{ workflowId: string; runId: string }> {
    const id = workflowId ?? `organize-${Date.now()}`;

    try {
      const handle = await this.client.workflow.start('organizeLibrary', {
        taskQueue: this.taskQueue,
        workflowId: id,
        args: [input],
      });

      this.logger.log(`Started organizeLibrary workflow: ${id}`);
      return { workflowId: id, runId: handle.firstExecutionRunId };
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        this.logger.warn(`Workflow ${id} already running`);
        const handle = this.client.workflow.getHandle(id);
        const desc = await handle.describe();
        return { workflowId: id, runId: desc.runId };
      }
      throw error;
    }
  }

  async getOrganizeProgress(
    workflowId: string,
  ): Promise<OrganizeLibraryProgress> {
    const handle = this.client.workflow.getHandle(workflowId);
    return handle.query<OrganizeLibraryProgress>('getProgress');
  }

  async getOrganizeResult(
    workflowId: string,
  ): Promise<OrganizeLibraryResult> {
    const handle = this.client.workflow.getHandle(workflowId);
    return handle.result();
  }

  async getStagingTree(workflowId: string): Promise<FileTreeNode[]> {
    const handle = this.client.workflow.getHandle(workflowId);
    return handle.query<FileTreeNode[]>('getStagingTree');
  }

  async finalize(
    workflowId: string,
    decision: FinalizeDecision,
  ): Promise<void> {
    const handle = this.client.workflow.getHandle(workflowId);
    await handle.signal('finalize', decision);
    this.logger.log(
      `Sent finalize signal to ${workflowId}: ${decision.approved ? 'approved' : 'rejected'}`,
    );
  }

  // ── Workflow: processFolder (child workflow signals) ──

  async sendReviewDecision(
    workflowId: string,
    decision: ReviewDecision,
  ): Promise<void> {
    const handle = this.client.workflow.getHandle(workflowId);
    await handle.signal('reviewDecision', decision);
    this.logger.debug(
      `Sent review decision to ${workflowId}: ${decision.reviewItemId}`,
    );
  }

  async sendDetectionConfirmation(
    workflowId: string,
    confirmation: DetectionConfirmation,
  ): Promise<void> {
    const handle = this.client.workflow.getHandle(workflowId);
    await handle.signal('detectionConfirmation', confirmation);
    this.logger.debug(
      `Sent detection confirmation to ${workflowId}: ${confirmation.confirmed}`,
    );
  }

  // ── Workflow: listSeriesRoots ──

  async listSeriesRoots(): Promise<Array<{ name: string; path: string }>> {
    const id = `list-roots-${Date.now()}`;
    const handle = await this.client.workflow.start(
      'listSeriesRootsWorkflow',
      {
        taskQueue: this.taskQueue,
        workflowId: id,
        args: [],
      },
    );

    return handle.result();
  }

  // ── Generic utilities ──

  async cancelWorkflow(workflowId: string): Promise<void> {
    const handle = this.client.workflow.getHandle(workflowId);
    await handle.cancel();
    this.logger.log(`Cancelled workflow: ${workflowId}`);
  }

  async getWorkflowStatus(
    workflowId: string,
  ): Promise<{ status: string; runId: string }> {
    const handle = this.client.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    return {
      status: desc.status.name,
      runId: desc.runId,
    };
  }

  getHandle(workflowId: string): WorkflowHandle {
    return this.client.workflow.getHandle(workflowId);
  }
}
