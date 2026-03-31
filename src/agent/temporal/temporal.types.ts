/**
 * Client-side types mirroring SERAEX workflow interfaces.
 * These must stay in sync with SERAEX's shared/types.ts.
 */

// ── Workflow Inputs / Outputs ──

export interface OrganizeLibraryInput {
  sourceDir: string;
  dryRun?: boolean;
  confidenceThreshold?: number;
  processingRoot?: string;
  stagingRoot?: string;
  outputRoot?: string;
}

export interface OrganizeLibraryResult {
  totalFolders: number;
  completed: number;
  failed: number;
  pendingReview: number;
  folders: FolderResult[];
  extraFiles: string[];
}

export type FolderStatus =
  | 'pending'
  | 'scanning'
  | 'extracting'
  | 'matching'
  | 'renaming'
  | 'awaiting_detection_review'
  | 'awaiting_review'
  | 'completed'
  | 'failed';

export interface FolderResult {
  folderName: string;
  folderPath: string;
  status: FolderStatus;
  episodesFound: number;
  episodesRenamed: number;
  episodesPendingReview: number;
  error?: string;
}

// ── Signal Payloads (HITL) ──

export interface ReviewDecision {
  reviewItemId: string;
  approved: boolean;
  correctedSeasonNumber?: number;
  correctedEpisodeNumber?: number;
}

export interface DetectionConfirmation {
  confirmed: boolean;
  addedPaths?: string[];
  removedPaths?: string[];
}

export interface FinalizeDecision {
  approved: boolean;
}

// ── Progress / Query Types ──

export type WorkflowStage =
  | 'copying'
  | 'fetching_metadata'
  | 'processing_folders'
  | 'structuring'
  | 'awaiting_finalize'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface CopyProgress {
  totalFiles: number;
  filesCopied: number;
  totalBytes: number;
  bytesCopied: number;
  currentFiles: string[];
  currentFileSizes: number[];
}

export interface MetadataSummary {
  status: 'searching' | 'found' | 'traversing' | 'fetching_episodes' | 'complete';
  seriesName?: string;
  seasonCount?: number;
  seasons?: Array<{ seasonNumber: number; title: string; episodeCount: number }>;
  totalEpisodes?: number;
}

export interface StructuringProgress {
  totalFiles: number;
  filesStructured: number;
  currentFile?: string;
}

export interface OutputProgress {
  totalFiles: number;
  filesCopied: number;
  currentFiles: string[];
}

export interface ReviewItem {
  id: string;
  fileName: string;
  filePath: string;
  subtitleSnippet: string;
  suggestedSeasonNumber: number;
  suggestedEpisodeNumber: number;
  suggestedEpisodeTitle: string;
  confidence: number;
  reasoning: string;
}

export interface OrganizeLibraryProgress {
  workflowStage: WorkflowStage;
  copyProgress?: CopyProgress;
  metadataSummary?: MetadataSummary;
  structuringProgress?: StructuringProgress;
  outputProgress?: OutputProgress;
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

export interface ProcessFolderProgress {
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
  pendingReviews: ReviewItem[];
}

export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  relativePath: string;
  size?: number;
  children?: FileTreeNode[];
}
