import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { readdir, stat } from 'fs/promises';
import { basename, join, resolve } from 'path';
import {
  WorkflowsGateway,
  type WorkflowUpdateEvent,
} from './workflows.gateway';
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
type WorkflowStage =
  | 'copying'
  | 'detecting'
  | 'extracting'
  | 'matching'
  | 'awaiting_review'
  | 'renaming'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'canceled';
const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.m4v']);

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
  workflowStage: WorkflowStage;
  selectedSeriesRoot: string;
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
  workflowStage: WorkflowStage;
  selectedSeriesRoot: string;
  expectedCoreEpisodeCount: number;
  resolvedCoreEpisodeCount: number;
  unresolvedCoreEpisodeCount: number;
  canFinalize: boolean;
  awaitingFinalApproval: boolean;
}

export interface SeriesRootDto {
  name: string;
  path: string;
}

@Injectable()
export class WorkflowsService {
  private readonly workflows = new Map<string, DummyWorkflowState>();

  constructor(
    private readonly workflowsGateway: WorkflowsGateway,
    @InjectModel(Workflow.name)
    private readonly workflowModel: Model<WorkflowDocument>,
  ) {}

  async listSeriesRoots(): Promise<SeriesRootDto[]> {
    const inputRoot = this.getInputRoot();
    const entries = await readdir(inputRoot, { withFileTypes: true });
    const roots = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: join(inputRoot, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return roots;
  }

  async startWorkflowForThread(
    threadId: string,
    seriesRootPath: string,
  ): Promise<{ workflowId: string; message: string }> {
    const selectedRoot = this.validateSeriesRootPath(seriesRootPath);
    const selectedStat = await stat(selectedRoot).catch(() => null);
    if (!selectedStat || !selectedStat.isDirectory()) {
      throw new BadRequestException('Selected series root does not exist');
    }
    const workflowId = this.generateWorkflowId();
    const now = new Date().toISOString();
    const folderName = basename(selectedRoot);
    const folderWorkflowId = `process-folder-${workflowId}-${this.sanitizeWorkflowId(folderName)}`;

    const videoFiles = await this.listVideoFiles(selectedRoot);
    const expectedCoreEpisodeCount = Math.min(
      await this.estimateCoreEpisodeCount(folderName, videoFiles.length),
      videoFiles.length,
    );
    const unresolvedCoreEpisodeCount = Math.min(2, expectedCoreEpisodeCount);
    const resolvedCoreEpisodeCount =
      expectedCoreEpisodeCount - unresolvedCoreEpisodeCount;

    const pendingReviews = videoFiles.slice(0, unresolvedCoreEpisodeCount).map((file, idx) => ({
      id: crypto.randomUUID(),
      fileName: basename(file),
      filePath: file,
      subtitleSnippet: '',
      suggestedEpisodeNumber: resolvedCoreEpisodeCount + idx + 1,
      suggestedEpisodeTitle: `Episode ${resolvedCoreEpisodeCount + idx + 1}`,
      confidence: 0.52,
      reasoning:
        'Low-confidence automatic match. Manual episode confirmation required before finalize.',
      availableEpisodes: Array.from(
        { length: expectedCoreEpisodeCount },
        (_, epIdx) => ({
          number: epIdx + 1,
          title: null,
          description: null,
        }),
      ),
    }));

    const state: DummyWorkflowState = {
      threadId,
      workflowId,
      status: 'RUNNING',
      startTime: now,
      closeTime: null,
      taskQueue: 'seraex-media-organizer',
      folderName,
      folderWorkflowId,
      folderStatus:
        unresolvedCoreEpisodeCount > 0 ? 'awaiting_review' : 'renaming',
      pendingReviews,
      totalFiles: videoFiles.length,
      filesProcessed: resolvedCoreEpisodeCount,
      workflowStage:
        unresolvedCoreEpisodeCount > 0 ? 'awaiting_review' : 'renaming',
      selectedSeriesRoot: selectedRoot,
      expectedCoreEpisodeCount,
      resolvedCoreEpisodeCount,
      unresolvedCoreEpisodeCount,
      canFinalize: unresolvedCoreEpisodeCount === 0,
      awaitingFinalApproval: unresolvedCoreEpisodeCount === 0,
    };

    this.workflows.set(workflowId, state);
    this.emitWorkflowUpdate(state);

    return {
      workflowId,
      message:
        unresolvedCoreEpisodeCount > 0
          ? `Workflow started for ${folderName}. ${unresolvedCoreEpisodeCount} episode mappings need review before finalize.`
          : `Workflow started for ${folderName}. Ready for finalize approval.`,
    };
  }

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
      workflowStage: 'awaiting_review',
      selectedSeriesRoot: '/mnt/input/Dummy Anime Season 1',
      expectedCoreEpisodeCount: 3,
      resolvedCoreEpisodeCount: 1,
      unresolvedCoreEpisodeCount: 2,
      canFinalize: false,
      awaitingFinalApproval: false,
    };

    this.workflows.set(workflowId, state);
    this.emitWorkflowUpdate(state);

    return workflowId;
  }

  async getWorkflowDescription(
    workflowId: string,
  ): Promise<WorkflowDescriptionDto> {
    const wf = this.workflows.get(workflowId);
    if (wf) {
      return {
        workflowId: wf.workflowId,
        status: wf.status,
        startTime: wf.startTime,
        closeTime: wf.closeTime,
        taskQueue: wf.taskQueue,
      };
    }

    const doc = await this.workflowModel.findOne({ workflowId }).lean().exec();
    if (!doc) {
      throw new NotFoundException(`Workflow '${workflowId}' not found`);
    }

    return {
      workflowId: doc.workflowId,
      status: this.mapStoredStatusToRuntimeStatus(doc.status),
      startTime: new Date(doc.startedAt).toISOString(),
      closeTime:
        doc.status === 'completed' || doc.status === 'failed' || doc.status === 'canceled'
          ? new Date(doc.lastSyncedAt).toISOString()
          : null,
      taskQueue: 'seraex-media-organizer',
    };
  }

  async getWorkflowProgress(
    workflowId: string,
  ): Promise<OrganizeLibraryProgressDto> {
    const wf = this.workflows.get(workflowId);
    if (!wf) {
      const doc = await this.workflowModel.findOne({ workflowId }).lean().exec();
      if (!doc || !doc.progress) {
        throw new NotFoundException(`Workflow '${workflowId}' not found`);
      }
      return doc.progress as unknown as OrganizeLibraryProgressDto;
    }

    const folderStatuses: Record<string, FolderStatus> = {
      [wf.folderName]: wf.folderStatus,
    };

    return {
      totalFolders: 1,
      foldersCompleted: wf.folderStatus === 'completed' ? 1 : 0,
      foldersFailed: wf.folderStatus === 'failed' ? 1 : 0,
      foldersInProgress:
        wf.folderStatus !== 'completed' &&
        wf.folderStatus !== 'failed' &&
        wf.folderStatus !== 'awaiting_review'
          ? 1
          : 0,
      foldersPendingReview: wf.folderStatus === 'awaiting_review' ? 1 : 0,
      folderStatuses,
      workflowStage: wf.workflowStage,
      selectedSeriesRoot: wf.selectedSeriesRoot,
      expectedCoreEpisodeCount: wf.expectedCoreEpisodeCount,
      resolvedCoreEpisodeCount: wf.resolvedCoreEpisodeCount,
      unresolvedCoreEpisodeCount: wf.unresolvedCoreEpisodeCount,
      canFinalize: wf.canFinalize,
      awaitingFinalApproval: wf.awaitingFinalApproval,
    };
  }

  getFolderProgress(folderWorkflowId: string): ProcessFolderProgressDto {
    const wf = this.findByFolderWorkflowId(folderWorkflowId);
    return {
      folderName: wf.folderName,
      status: wf.folderStatus,
      totalFiles: wf.totalFiles,
      filesProcessed: wf.filesProcessed,
      pendingReviews: wf.pendingReviews.filter((item) => !!item.id),
    };
  }

  getPendingReviews(folderWorkflowId: string): ReviewItemDto[] {
    const wf = this.findByFolderWorkflowId(folderWorkflowId);
    return wf.pendingReviews;
  }

  submitReviewDecision(
    folderWorkflowId: string,
    decision: ReviewDecisionDto,
  ): { success: boolean; message?: string } {
    const wf = this.findByFolderWorkflowId(folderWorkflowId);
    const existing = wf.pendingReviews.find((item) => item.id === decision.reviewItemId);
    if (!existing) {
      throw new NotFoundException(`Review item '${decision.reviewItemId}' not found`);
    }

    if (!decision.approved) {
      return {
        success: false,
        message:
          'Finalize is blocked. Every core episode must be explicitly mapped.',
      };
    }

    wf.pendingReviews = wf.pendingReviews.filter((item) => item.id !== decision.reviewItemId);
    if (wf.unresolvedCoreEpisodeCount > 0) {
      wf.unresolvedCoreEpisodeCount -= 1;
      wf.resolvedCoreEpisodeCount += 1;
      wf.filesProcessed += 1;
    }

    if (wf.pendingReviews.length === 0 && wf.status === 'RUNNING') {
      wf.workflowStage = 'renaming';
      wf.folderStatus = 'renaming';
      wf.canFinalize = true;
      wf.awaitingFinalApproval = true;
      this.emitWorkflowUpdate(wf);
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
      wf.workflowStage = 'canceled';
      wf.canFinalize = false;
      wf.awaitingFinalApproval = false;
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

  async finalizeWorkflow(
    threadId: string,
    workflowId: string,
  ): Promise<{ success: boolean }> {
    const wf = this.workflows.get(workflowId);
    if (!wf || wf.threadId !== threadId) {
      throw new NotFoundException(`Workflow '${workflowId}' not found`);
    }
    if (wf.status !== 'RUNNING') {
      throw new BadRequestException('Only running workflows can be finalized');
    }
    if (!wf.canFinalize || wf.unresolvedCoreEpisodeCount > 0) {
      throw new BadRequestException(
        'Finalize blocked: unresolved core episodes remain',
      );
    }

    wf.workflowStage = 'finalizing';
    wf.folderStatus = 'moving';
    this.emitWorkflowUpdate(wf);

    wf.folderStatus = 'completed';
    wf.workflowStage = 'completed';
    wf.awaitingFinalApproval = false;
    wf.canFinalize = false;
    wf.status = 'COMPLETED';
    wf.closeTime = new Date().toISOString();
    this.emitWorkflowUpdate(wf);
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

  private async listVideoFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();
        if (Array.from(VIDEO_EXTENSIONS).some((ext) => lower.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    }
    files.sort((a, b) => a.localeCompare(b));
    return files;
  }

  private validateSeriesRootPath(inputPath: string): string {
    const inputRoot = resolve(this.getInputRoot());
    const candidate = resolve(inputPath);
    if (!candidate.startsWith(inputRoot + '/')) {
      throw new BadRequestException('seriesRootPath must be inside input root');
    }
    return candidate;
  }

  private getInputRoot(): string {
    return process.env.MEDIA_INPUT_ROOT ?? '/mnt/media/input';
  }

  private async estimateCoreEpisodeCount(
    seriesName: string,
    fallbackCount: number,
  ): Promise<number> {
    try {
      const query = `
        query ($search: String) {
          Media(search: $search, type: ANIME, format: TV, sort: SEARCH_MATCH) {
            episodes
          }
        }
      `;
      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { search: seriesName } }),
      });
      if (!response.ok) return fallbackCount;
      const payload = (await response.json()) as {
        data?: { Media?: { episodes?: number | null } };
      };
      const episodes = payload.data?.Media?.episodes;
      if (!episodes || episodes < 1) return fallbackCount;
      return episodes;
    } catch {
      return fallbackCount;
    }
  }

  private mapStoredStatusToRuntimeStatus(status: string): WorkflowRuntimeStatus {
    if (status === 'completed') return 'COMPLETED';
    if (status === 'failed') return 'FAILED';
    if (status === 'canceled') return 'CANCELED';
    return 'RUNNING';
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
      progress: {
        totalFolders: 1,
        foldersCompleted: wf.folderStatus === 'completed' ? 1 : 0,
        foldersFailed: wf.folderStatus === 'failed' ? 1 : 0,
        foldersInProgress:
          wf.folderStatus !== 'completed' &&
          wf.folderStatus !== 'failed' &&
          wf.folderStatus !== 'awaiting_review'
            ? 1
            : 0,
        foldersPendingReview: wf.folderStatus === 'awaiting_review' ? 1 : 0,
        folderStatuses: {
          [wf.folderName]: wf.folderStatus,
        },
        workflowStage: wf.workflowStage,
        selectedSeriesRoot: wf.selectedSeriesRoot,
        expectedCoreEpisodeCount: wf.expectedCoreEpisodeCount,
        resolvedCoreEpisodeCount: wf.resolvedCoreEpisodeCount,
        unresolvedCoreEpisodeCount: wf.unresolvedCoreEpisodeCount,
        canFinalize: wf.canFinalize,
        awaitingFinalApproval: wf.awaitingFinalApproval,
      } satisfies OrganizeLibraryProgressDto,
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
            progress: event.progress as unknown as Record<string, unknown>,
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

