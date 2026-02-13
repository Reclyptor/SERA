import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client } from '@temporalio/client';
import { TEMPORAL_CLIENT } from '../temporal/temporal.module';
import {
  WorkflowsGateway,
  type WorkflowUpdateEvent,
} from './workflows.gateway';
import { Workflow, WorkflowDocument } from './schemas/workflow.schema';

// ── Constants ───────────────────────────────────────────────────────

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? 'SERA';
const SYNC_INTERVAL_MS = 5_000;

// ── DTOs ────────────────────────────────────────────────────────────

type WorkflowRuntimeStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';

type FolderStatus =
  | 'pending'
  | 'scanning'
  | 'extracting'
  | 'matching'
  | 'renaming'
  | 'awaiting_detection_review'
  | 'awaiting_review'
  | 'completed'
  | 'failed';

type WorkflowStage =
  | 'copying'
  | 'fetching_metadata'
  | 'processing_folders'
  | 'structuring'
  | 'awaiting_finalize'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface WorkflowDescriptionDto {
  workflowId: string;
  status: WorkflowRuntimeStatus;
  startTime: string;
  closeTime: string | null;
  taskQueue: string;
}

export interface CopyProgressDto {
  totalFiles: number;
  filesCopied: number;
  totalBytes: number;
  bytesCopied: number;
  currentFiles: string[];
  currentFileSizes: number[];
}

export interface MetadataSummaryDto {
  status: 'searching' | 'found' | 'traversing' | 'fetching_episodes' | 'complete';
  seriesName?: string;
  seasonCount?: number;
  seasons?: Array<{ seasonNumber: number; title: string; episodeCount: number }>;
  totalEpisodes?: number;
}

export interface StructuringProgressDto {
  totalFiles: number;
  filesStructured: number;
  currentFile?: string;
}

export interface OutputProgressDto {
  totalFiles: number;
  filesCopied: number;
  currentFiles: string[];
}

export interface OrganizeLibraryProgressDto {
  workflowStage: WorkflowStage;
  copyProgress?: CopyProgressDto;
  metadataSummary?: MetadataSummaryDto;
  structuringProgress?: StructuringProgressDto;
  outputProgress?: OutputProgressDto;
  totalFolders: number;
  foldersCompleted: number;
  foldersFailed: number;
  foldersInProgress: number;
  foldersPendingReview: number;
  folderStatuses: Record<string, FolderStatus>;
  expectedCoreEpisodeCount: number;
  resolvedCoreEpisodeCount: number;
  unresolvedCoreEpisodeCount: number;
  canFinalize: boolean;
  awaitingFinalApproval: boolean;
}

export interface AnimeEpisodeDto {
  number: number;
  title: string | null;
  description: string | null;
}

export interface ReviewItemDto {
  id: string;
  fileName: string;
  filePath: string;
  subtitleSnippet: string;
  suggestedEpisodeNumber: number;
  suggestedEpisodeTitle: string;
  confidence: number;
  reasoning: string;
  availableEpisodes: AnimeEpisodeDto[];
}

export interface ProcessFolderProgressDto {
  folderName: string;
  status: FolderStatus;
  totalVideoFiles?: number;
  detectedEpisodeCount?: number;
  detectionConfidence?: 'high' | 'medium' | 'low';
  totalEpisodeFiles?: number;
  subtitlesExtracted?: number;
  currentFile?: string;
  matchesFound?: number;
  totalToMatch?: number;
  episodesCopied?: number;
  totalEpisodesToCopy?: number;
  pendingReviews: ReviewItemDto[];
}

export interface DetectionConfirmationDto {
  confirmed: boolean;
  addedPaths?: string[];
  removedPaths?: string[];
}

export interface ReviewDecisionDto {
  reviewItemId: string;
  approved: boolean;
  correctedSeasonNumber?: number;
  correctedEpisodeNumber?: number;
}

export interface PersistedWorkflowStateDto {
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'unknown' | 'canceled';
  progress: Record<string, unknown> | null;
  pendingReviewWorkflows: string[];
  startedAt: string;
  lastSyncedAt: string;
}

export interface SeriesRootDto {
  name: string;
  path: string;
}

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class WorkflowsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowsService.name);
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(TEMPORAL_CLIENT)
    private readonly temporal: Client,
    private readonly workflowsGateway: WorkflowsGateway,
    @InjectModel(Workflow.name)
    private readonly workflowModel: Model<WorkflowDocument>,
  ) {}

  onModuleInit(): void {
    this.syncTimer = setInterval(() => {
      void this.syncAllRunningWorkflows();
    }, SYNC_INTERVAL_MS);
    this.logger.log(
      `Started workflow progress sync loop (every ${SYNC_INTERVAL_MS / 1000}s)`,
    );
  }

  onModuleDestroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private async syncAllRunningWorkflows(): Promise<void> {
    let docs: Array<{ threadId: string; workflowId: string }>;
    try {
      docs = await this.workflowModel
        .find({ status: 'running' })
        .select('threadId workflowId')
        .lean()
        .exec();
    } catch (err) {
      this.logger.warn('Failed to query running workflows for sync', err);
      return;
    }

    for (const doc of docs) {
      try {
        await this.syncWorkflowProgress(doc.threadId, doc.workflowId);
      } catch {
        // Individual failures are logged inside syncWorkflowProgress
      }
    }
  }

  // ── Series Roots (via Temporal → SERAEX) ────────────────────────

  async listSeriesRoots(): Promise<SeriesRootDto[]> {
    const handle = await this.temporal.workflow.start(
      'listSeriesRootsWorkflow',
      {
        taskQueue: TASK_QUEUE,
        workflowId: `list-series-roots-${Date.now()}`,
      },
    );
    return handle.result();
  }

  // ── Start Workflow ──────────────────────────────────────────────

  async startWorkflowForThread(
    threadId: string,
    seriesRootPath: string,
  ): Promise<{ workflowId: string; message: string }> {
    if (!seriesRootPath || seriesRootPath === '/') {
      throw new BadRequestException('Invalid series root path');
    }

    const workflowId = `organize-${crypto.randomUUID()}`;
    const folderName = seriesRootPath.split('/').filter(Boolean).pop() ?? 'unknown';

    // Start the Temporal workflow — the worker resolves output/staging
    // paths from its own environment config
    await this.temporal.workflow.start('organizeLibrary', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [
        {
          sourceDir: seriesRootPath,
          processingRoot: process.env.MEDIA_PROCESSING_ROOT ?? '/mnt/media/processing',
          stagingRoot: process.env.MEDIA_STAGING_ROOT ?? '/mnt/media/staging',
          outputRoot: process.env.MEDIA_OUTPUT_ROOT ?? '/mnt/media/output',
        },
      ],
    });

    this.logger.log(
      `Started Temporal workflow ${workflowId} for series "${folderName}"`,
    );

    // Record in MongoDB for thread association
    await this.workflowModel
      .updateOne(
        { threadId, workflowId },
        {
          $set: {
            status: 'running',
            progress: null,
            pendingReviewWorkflows: [],
            startedAt: new Date(),
            lastSyncedAt: new Date(),
          },
        },
        { upsert: true },
      )
      .exec();

    // Emit initial WebSocket update
    this.workflowsGateway.emitWorkflowUpdate({
      threadId,
      workflowId,
      status: 'running',
      progress: {
        totalFolders: 0,
        foldersCompleted: 0,
        foldersFailed: 0,
        foldersInProgress: 0,
        foldersPendingReview: 0,
        folderStatuses: {},
        workflowStage: 'copying',
        expectedCoreEpisodeCount: 0,
        resolvedCoreEpisodeCount: 0,
        unresolvedCoreEpisodeCount: 0,
        canFinalize: false,
        awaitingFinalApproval: false,
      },
      pendingReviewWorkflows: [],
      lastSyncedAt: new Date().toISOString(),
    });

    return {
      workflowId,
      message: `Workflow started for ${folderName}.`,
    };
  }

  // ── Workflow Description ────────────────────────────────────────

  async getWorkflowDescription(
    workflowId: string,
  ): Promise<WorkflowDescriptionDto> {
    try {
      const handle = this.temporal.workflow.getHandle(workflowId);
      const desc = await handle.describe();

      return {
        workflowId: desc.workflowId,
        status: this.mapTemporalStatus(desc.status.name),
        startTime: desc.startTime?.toISOString() ?? new Date().toISOString(),
        closeTime: desc.closeTime?.toISOString() ?? null,
        taskQueue: desc.taskQueue,
      };
    } catch {
      // Fall back to MongoDB if Temporal doesn't know this workflow
      const doc = await this.workflowModel
        .findOne({ workflowId })
        .lean()
        .exec();
      if (!doc) {
        throw new NotFoundException(`Workflow '${workflowId}' not found`);
      }
      return {
        workflowId: doc.workflowId,
        status: this.mapStoredStatusToRuntimeStatus(doc.status),
        startTime: new Date(doc.startedAt).toISOString(),
        closeTime:
          doc.status === 'completed' ||
          doc.status === 'failed' ||
          doc.status === 'canceled'
            ? new Date(doc.lastSyncedAt).toISOString()
            : null,
        taskQueue: TASK_QUEUE,
      };
    }
  }

  // ── Workflow Progress (queries Temporal) ─────────────────────────

  async getWorkflowProgress(
    workflowId: string,
  ): Promise<OrganizeLibraryProgressDto> {
    try {
      const handle = this.temporal.workflow.getHandle(workflowId);
      const progress = await handle.query<OrganizeLibraryProgressDto>(
        'getProgress',
      );
      return progress;
    } catch {
      // Fall back to last-known progress in MongoDB
      const doc = await this.workflowModel
        .findOne({ workflowId })
        .lean()
        .exec();
      if (!doc || !doc.progress) {
        throw new NotFoundException(`Workflow '${workflowId}' not found`);
      }
      return doc.progress as unknown as OrganizeLibraryProgressDto;
    }
  }

  // ── Folder Progress (queries child workflow in Temporal) ─────────

  async getFolderProgress(
    folderWorkflowId: string,
  ): Promise<ProcessFolderProgressDto> {
    try {
      const handle = this.temporal.workflow.getHandle(folderWorkflowId);
      return await handle.query<ProcessFolderProgressDto>('getProgress');
    } catch {
      throw new NotFoundException(
        `Folder workflow '${folderWorkflowId}' not found`,
      );
    }
  }

  // ── Pending Reviews (queries child workflow) ─────────────────────

  async getPendingReviews(
    folderWorkflowId: string,
  ): Promise<ReviewItemDto[]> {
    try {
      const handle = this.temporal.workflow.getHandle(folderWorkflowId);
      const progress = await handle.query<ProcessFolderProgressDto>(
        'getProgress',
      );
      return progress.pendingReviews;
    } catch {
      throw new NotFoundException(
        `Folder workflow '${folderWorkflowId}' not found`,
      );
    }
  }

  // ── Submit Review Decision (signals child workflow) ──────────────

  async submitReviewDecision(
    folderWorkflowId: string,
    decision: ReviewDecisionDto,
  ): Promise<{ success: boolean; message?: string }> {
    if (!decision.approved) {
      return {
        success: false,
        message:
          'Finalize is blocked. Every core episode must be explicitly mapped.',
      };
    }

    try {
      const handle = this.temporal.workflow.getHandle(folderWorkflowId);
      await handle.signal('reviewDecision', {
        reviewItemId: decision.reviewItemId,
        approved: decision.approved,
        correctedSeasonNumber: decision.correctedSeasonNumber,
        correctedEpisodeNumber: decision.correctedEpisodeNumber,
      });

      return { success: true };
    } catch (err) {
      this.logger.error(
        `Failed to signal review decision to ${folderWorkflowId}`,
        err,
      );
      throw new BadRequestException('Failed to submit review decision');
    }
  }

  // ── Staging Tree (queries Temporal) ─────────────────────────────

  async getStagingTree(workflowId: string): Promise<unknown[]> {
    try {
      const handle = this.temporal.workflow.getHandle(workflowId);
      return await handle.query<unknown[]>('getStagingTree');
    } catch {
      throw new NotFoundException(
        `Workflow '${workflowId}' not found or staging tree not available`,
      );
    }
  }

  // ── Thread Workflow State (MongoDB) ──────────────────────────────

  async getThreadWorkflowState(
    threadId: string,
  ): Promise<PersistedWorkflowStateDto[]> {
    const docs = await this.workflowModel
      .find({ threadId })
      .sort({ startedAt: 1 })
      .lean()
      .exec();

    // For running workflows, refresh progress from Temporal
    const states: PersistedWorkflowStateDto[] = [];

    for (const doc of docs) {
      let progress = (doc.progress as Record<string, unknown> | null) ?? null;
      let status = doc.status as PersistedWorkflowStateDto['status'];

      if (status === 'running') {
        try {
          const handle = this.temporal.workflow.getHandle(doc.workflowId);
          const desc = await handle.describe();
          const temporalStatus = this.mapTemporalStatus(desc.status.name);

          if (temporalStatus !== 'RUNNING') {
            // Workflow finished since we last synced — update MongoDB
            status = this.runtimeStatusToStored(temporalStatus);
            await this.workflowModel
              .updateOne(
                { threadId, workflowId: doc.workflowId },
                { $set: { status, lastSyncedAt: new Date() } },
              )
              .exec();
          }

          try {
            const liveProgress =
              await handle.query<OrganizeLibraryProgressDto>('getProgress');
            progress = liveProgress as unknown as Record<string, unknown>;
          } catch {
            // Query may fail for completed/failed workflows
          }
        } catch {
          // Temporal may not know this workflow (e.g., old dummy)
        }
      }

      states.push({
        workflowId: doc.workflowId,
        status,
        progress,
        pendingReviewWorkflows: doc.pendingReviewWorkflows ?? [],
        startedAt: new Date(doc.startedAt).toISOString(),
        lastSyncedAt: new Date(doc.lastSyncedAt).toISOString(),
      });
    }

    return states;
  }

  // ── Cancel Workflow ─────────────────────────────────────────────

  async cancelWorkflow(
    threadId: string,
    workflowId: string,
  ): Promise<{ success: boolean }> {
    // Cancel in Temporal
    try {
      const handle = this.temporal.workflow.getHandle(workflowId);
      await handle.cancel();
      this.logger.log(`Canceled Temporal workflow ${workflowId}`);
    } catch (err) {
      this.logger.warn(
        `Temporal cancel failed for ${workflowId} (may already be terminal)`,
        err,
      );
    }

    // Update MongoDB
    await this.workflowModel
      .updateOne(
        { threadId, workflowId },
        {
          $set: {
            status: 'canceled',
            pendingReviewWorkflows: [],
            lastSyncedAt: new Date(),
          },
        },
      )
      .exec();

    // Emit WebSocket update
    this.workflowsGateway.emitWorkflowUpdate({
      threadId,
      workflowId,
      status: 'canceled',
      progress: null,
      pendingReviewWorkflows: [],
      lastSyncedAt: new Date().toISOString(),
    });

    return { success: true };
  }

  // ── Finalize / Reject Workflow (signals parent workflow) ─────────

  async finalizeWorkflow(
    threadId: string,
    workflowId: string,
    approved: boolean = true,
  ): Promise<{ success: boolean }> {
    const doc = await this.workflowModel
      .findOne({ threadId, workflowId })
      .lean()
      .exec();
    if (!doc) {
      throw new NotFoundException(`Workflow '${workflowId}' not found`);
    }
    if (doc.status !== 'running') {
      throw new BadRequestException(
        'Only running workflows can be finalized or rejected',
      );
    }

    try {
      const handle = this.temporal.workflow.getHandle(workflowId);

      if (approved) {
        const progress = await handle.query<OrganizeLibraryProgressDto>(
          'getProgress',
        );
        if (!progress.canFinalize || progress.unresolvedCoreEpisodeCount > 0) {
          throw new BadRequestException(
            'Finalize blocked: unresolved core episodes remain',
          );
        }
      }

      await handle.signal('finalize', { approved });
      this.logger.log(
        `Sent ${approved ? 'finalize' : 'reject'} signal to workflow ${workflowId}`,
      );

      return { success: true };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(
        `Failed to ${approved ? 'finalize' : 'reject'} workflow ${workflowId}`,
        err,
      );
      throw new BadRequestException(
        `Failed to ${approved ? 'finalize' : 'reject'} workflow`,
      );
    }
  }

  // ── Confirm Detection (signals child workflow) ─────────────────

  async confirmDetection(
    folderWorkflowId: string,
    confirmation: DetectionConfirmationDto,
  ): Promise<{ success: boolean }> {
    try {
      const handle = this.temporal.workflow.getHandle(folderWorkflowId);
      await handle.signal('detectionConfirmation', confirmation);
      return { success: true };
    } catch (err) {
      this.logger.error(
        `Failed to signal detection confirmation to ${folderWorkflowId}`,
        err,
      );
      throw new BadRequestException('Failed to confirm detection');
    }
  }

  // ── Sync Progress (call from controller or background job) ──────

  async syncWorkflowProgress(
    threadId: string,
    workflowId: string,
  ): Promise<void> {
    try {
      const handle = this.temporal.workflow.getHandle(workflowId);
      const desc = await handle.describe();
      const status = this.mapTemporalStatus(desc.status.name);
      const storedStatus = this.runtimeStatusToStored(status);

      let progress: OrganizeLibraryProgressDto | null = null;
      try {
        progress = await handle.query<OrganizeLibraryProgressDto>(
          'getProgress',
        );
      } catch {
        // Query may fail for completed workflows
      }

      const pendingReviewWorkflows: string[] = [];
      if (progress) {
        for (const [folderName, folderStatus] of Object.entries(
          progress.folderStatuses,
        )) {
          if (
            folderStatus === 'awaiting_review' ||
            folderStatus === 'awaiting_detection_review'
          ) {
            pendingReviewWorkflows.push(
              `${workflowId}/process-folder/${this.sanitizeWorkflowId(folderName)}`,
            );
          }
        }
      }

      // Update MongoDB
      await this.workflowModel
        .updateOne(
          { threadId, workflowId },
          {
            $set: {
              status: storedStatus,
              progress: progress as unknown as Record<string, unknown>,
              pendingReviewWorkflows,
              lastSyncedAt: new Date(),
            },
          },
        )
        .exec();

      // Emit WebSocket update
      this.workflowsGateway.emitWorkflowUpdate({
        threadId,
        workflowId,
        status: storedStatus,
        progress: progress as unknown as Record<string, unknown>,
        pendingReviewWorkflows,
        lastSyncedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to sync progress for ${workflowId}`,
        err,
      );
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private mapTemporalStatus(statusName: string): WorkflowRuntimeStatus {
    switch (statusName) {
      case 'RUNNING':
        return 'RUNNING';
      case 'COMPLETED':
        return 'COMPLETED';
      case 'FAILED':
      case 'TIMED_OUT':
      case 'TERMINATED':
        return 'FAILED';
      case 'CANCELED':
      case 'CANCELLED':
        return 'CANCELED';
      default:
        return 'RUNNING';
    }
  }

  private mapStoredStatusToRuntimeStatus(
    status: string,
  ): WorkflowRuntimeStatus {
    if (status === 'completed') return 'COMPLETED';
    if (status === 'failed') return 'FAILED';
    if (status === 'canceled') return 'CANCELED';
    return 'RUNNING';
  }

  private runtimeStatusToStored(
    status: WorkflowRuntimeStatus,
  ): PersistedWorkflowStateDto['status'] {
    switch (status) {
      case 'RUNNING':
        return 'running';
      case 'COMPLETED':
        return 'completed';
      case 'FAILED':
        return 'failed';
      case 'CANCELED':
        return 'canceled';
      default:
        return 'unknown';
    }
  }

  private sanitizeWorkflowId(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 200);
  }
}
