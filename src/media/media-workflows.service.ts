import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MediaWorkflowsGateway,
  type WorkflowUpdateEvent,
} from './media-workflows.gateway';
import { Workflow, WorkflowDocument } from './schemas/workflow.schema';

type WorkflowRuntimeStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
type FolderStatus =
  | 'pending'
  | 'scanning'
  | 'extracting'
  | 'matching'
  | 'renaming'
  | 'awaiting_review'
  | 'moving'
  | 'completed'
  | 'failed';

export interface WorkflowDescriptionDto {
  workflowId: string;
  status: WorkflowRuntimeStatus;
  startTime: string;
  closeTime: string | null;
  taskQueue: string;
}

export interface OrganizeLibraryProgressDto {
  totalFolders: number;
  foldersCompleted: number;
  foldersFailed: number;
  foldersInProgress: number;
  foldersPendingReview: number;
  folderStatuses: Record<string, FolderStatus>;
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
  totalFiles: number;
  filesProcessed: number;
  pendingReviews: ReviewItemDto[];
}

export interface ReviewDecisionDto {
  reviewItemId: string;
  approved: boolean;
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

interface DummyWorkflowState {
  threadId: string;
  workflowId: string;
  status: WorkflowRuntimeStatus;
  startTime: string;
  closeTime: string | null;
  taskQueue: string;
  folderName: string;
  folderWorkflowId: string;
  folderStatus: FolderStatus;
  pendingReviews: ReviewItemDto[];
  totalFiles: number;
  filesProcessed: number;
}

@Injectable()
export class MediaWorkflowsService {
  private readonly workflows = new Map<string, DummyWorkflowState>();

  constructor(
    private readonly workflowsGateway: MediaWorkflowsGateway,
    @InjectModel(Workflow.name)
    private readonly workflowModel: Model<WorkflowDocument>,
  ) {}

  startDummyWorkflow(parentThreadId?: string): string {
    const threadId = this.resolveThreadId(parentThreadId);
    const workflowId = this.generateWorkflowId();
    const folderName = 'Dummy Anime Season 1';
    const folderWorkflowId = `process-folder-${workflowId}-${this.sanitizeWorkflowId(folderName)}`;
    const now = new Date().toISOString();

    const pendingReviews: ReviewItemDto[] = [
      {
        id: crypto.randomUUID(),
        fileName: 'episode_unknown_01.mkv',
        filePath: '/mnt/anime/Dummy Anime Season 1/episode_unknown_01.mkv',
        subtitleSnippet:
          "I'll become the Pirate King! We set sail at dawn and head for the Grand Line.",
        suggestedEpisodeNumber: 1,
        suggestedEpisodeTitle: 'Romance Dawn',
        confidence: 0.82,
        reasoning:
          'Named entities and opening-arc dialogue strongly match episode 1 synopsis.',
        availableEpisodes: [
          {
            number: 1,
            title: 'Romance Dawn',
            description: 'Luffy begins his pirate adventure and sets sail.',
          },
          {
            number: 2,
            title: 'They Call Him Straw Hat Luffy',
            description: 'First crewmate encounters and early conflicts.',
          },
        ],
      },
    ];

    const state: DummyWorkflowState = {
      threadId,
      workflowId,
      status: 'RUNNING',
      startTime: now,
      closeTime: null,
      taskQueue: 'seraex-dummy',
      folderName,
      folderWorkflowId,
      folderStatus: 'scanning',
      pendingReviews,
      totalFiles: 3,
      filesProcessed: 1,
    };

    this.workflows.set(workflowId, state);
    this.emitWorkflowUpdate(state);

    // Deterministic progression so UI can be tested without real media logic.
    setTimeout(() => {
      const wf = this.workflows.get(workflowId);
      if (!wf || wf.status !== 'RUNNING') return;
      wf.folderStatus = 'awaiting_review';
      wf.filesProcessed = 2;
      this.emitWorkflowUpdate(wf);
    }, 3000);

    return workflowId;
  }

  getWorkflowDescription(workflowId: string): WorkflowDescriptionDto {
    const wf = this.requireWorkflow(workflowId);
    return {
      workflowId: wf.workflowId,
      status: wf.status,
      startTime: wf.startTime,
      closeTime: wf.closeTime,
      taskQueue: wf.taskQueue,
    };
  }

  getWorkflowProgress(workflowId: string): OrganizeLibraryProgressDto {
    const wf = this.requireWorkflow(workflowId);
    const folderStatuses: Record<string, FolderStatus> = {
      [wf.folderName]: wf.folderStatus,
    };

    return {
      totalFolders: 1,
      foldersCompleted: wf.folderStatus === 'completed' ? 1 : 0,
      foldersFailed: wf.folderStatus === 'failed' ? 1 : 0,
      foldersInProgress:
        wf.folderStatus !== 'completed' && wf.folderStatus !== 'failed' ? 1 : 0,
      foldersPendingReview: wf.folderStatus === 'awaiting_review' ? 1 : 0,
      folderStatuses,
    };
  }

  getFolderProgress(folderWorkflowId: string): ProcessFolderProgressDto {
    const wf = this.findByFolderWorkflowId(folderWorkflowId);
    return {
      folderName: wf.folderName,
      status: wf.folderStatus,
      totalFiles: wf.totalFiles,
      filesProcessed: wf.filesProcessed,
      pendingReviews: wf.pendingReviews,
    };
  }

  getPendingReviews(folderWorkflowId: string): ReviewItemDto[] {
    const wf = this.findByFolderWorkflowId(folderWorkflowId);
    return wf.pendingReviews;
  }

  submitReviewDecision(
    folderWorkflowId: string,
    decision: ReviewDecisionDto,
  ): { success: boolean } {
    const wf = this.findByFolderWorkflowId(folderWorkflowId);
    wf.pendingReviews = wf.pendingReviews.filter(
      (item) => item.id !== decision.reviewItemId,
    );

    if (wf.pendingReviews.length === 0 && wf.status === 'RUNNING') {
      wf.folderStatus = 'moving';
      wf.filesProcessed = wf.totalFiles;
      this.emitWorkflowUpdate(wf);
      setTimeout(() => {
        const latest = this.workflows.get(wf.workflowId);
        if (!latest || latest.status !== 'RUNNING') return;
        latest.folderStatus = 'completed';
        latest.status = 'COMPLETED';
        latest.closeTime = new Date().toISOString();
        this.emitWorkflowUpdate(latest);
      }, 2000);
    }

    return { success: true };
  }

  async getThreadWorkflowState(
    threadId: string,
  ): Promise<PersistedWorkflowStateDto[]> {
    const docs = await this.workflowModel
      .find({ threadId })
      .sort({ startedAt: 1 })
      .lean()
      .exec();

    return docs.map((doc) => ({
      workflowId: doc.workflowId,
      status: doc.status as PersistedWorkflowStateDto['status'],
      progress: (doc.progress as Record<string, unknown> | null) ?? null,
      pendingReviewWorkflows: doc.pendingReviewWorkflows ?? [],
      startedAt: new Date(doc.startedAt).toISOString(),
      lastSyncedAt: new Date(doc.lastSyncedAt).toISOString(),
    }));
  }

  async cancelWorkflow(
    threadId: string,
    workflowId: string,
  ): Promise<{ success: boolean }> {
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

    const wf = this.workflows.get(workflowId);
    if (wf && wf.threadId === threadId && wf.status === 'RUNNING') {
      wf.status = 'CANCELED';
      wf.folderStatus = 'failed';
      wf.closeTime = new Date().toISOString();
      this.emitWorkflowUpdate(wf);
    } else {
      const doc = await this.workflowModel.findOne({ threadId, workflowId }).lean();
      if (doc) {
        this.workflowsGateway.emitWorkflowUpdate({
          threadId,
          workflowId,
          status: 'canceled',
          progress: (doc.progress as Record<string, unknown> | null) ?? null,
          pendingReviewWorkflows: [],
          lastSyncedAt: new Date().toISOString(),
        });
      }
    }

    return { success: true };
  }

  private requireWorkflow(workflowId: string): DummyWorkflowState {
    const wf = this.workflows.get(workflowId);
    if (!wf) {
      throw new NotFoundException(`Workflow '${workflowId}' not found`);
    }
    return wf;
  }

  private findByFolderWorkflowId(folderWorkflowId: string): DummyWorkflowState {
    for (const wf of this.workflows.values()) {
      if (wf.folderWorkflowId === folderWorkflowId) {
        return wf;
      }
    }
    throw new NotFoundException(
      `Folder workflow '${folderWorkflowId}' not found`,
    );
  }

  private sanitizeWorkflowId(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 200);
  }

  private generateWorkflowId(): string {
    return crypto.randomUUID();
  }

  private resolveThreadId(parentThreadId?: string): string {
    if (parentThreadId && /^[a-f0-9-]{36}$/i.test(parentThreadId)) {
      return parentThreadId;
    }
    return crypto.randomUUID();
  }

  private emitWorkflowUpdate(wf: DummyWorkflowState): void {
    const mappedStatus: WorkflowUpdateEvent['status'] =
      wf.status === 'RUNNING'
        ? 'running'
        : wf.status === 'COMPLETED'
          ? 'completed'
          : wf.status === 'CANCELED'
            ? 'canceled'
            : 'failed';

    const event: WorkflowUpdateEvent = {
      threadId: wf.threadId,
      workflowId: wf.workflowId,
      status: mappedStatus,
      progress: this.getWorkflowProgress(wf.workflowId),
      pendingReviewWorkflows:
        wf.folderStatus === 'awaiting_review' ? [wf.folderWorkflowId] : [],
      lastSyncedAt: new Date().toISOString(),
    };
    this.workflowsGateway.emitWorkflowUpdate(event);
    void this.workflowModel
      .updateOne(
        { threadId: wf.threadId, workflowId: wf.workflowId },
        {
          $set: {
            status: mappedStatus,
            progress: this.getWorkflowProgress(wf.workflowId),
            pendingReviewWorkflows:
              wf.folderStatus === 'awaiting_review' ? [wf.folderWorkflowId] : [],
            startedAt: new Date(wf.startTime),
            lastSyncedAt: new Date(),
          },
        },
        { upsert: true },
      )
      .exec();
  }
}

