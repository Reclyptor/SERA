import { z } from 'zod';
import { createHash } from 'crypto';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';
import type { ToolApprovalRequester } from '../tool-approval.service';
import type {
  GitHubFile,
  GitHubHttpClient,
} from '../../../github/github-http-client.service';

const OPERATIONS = [
  'list_files',
  'read_file',
  'write_file',
  'delete_file',
  'list_commits',
] as const;

const parameters = z.object({
  operation: z.enum(OPERATIONS).describe('Repo operation to perform'),
  path: z
    .string()
    .optional()
    .describe('Repo-relative file path (read_file, write_file, delete_file)'),
  content: z.string().optional().describe('File contents UTF-8 (write_file)'),
  message: z
    .string()
    .optional()
    .describe('Commit message (write_file, delete_file)'),
  pathPrefix: z
    .string()
    .optional()
    .describe('Filter list_files results to paths starting with this prefix'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Cap list_files / list_commits results (default 100 / 20)'),
});

type Args = z.infer<typeof parameters>;

const LIST_FILES_DEFAULT_LIMIT = 100;
const LIST_COMMITS_DEFAULT_LIMIT = 20;

export class ClusterGitTool implements Tool<typeof parameters> {
  readonly name = 'cluster_git';
  readonly description =
    'Read and edit the FluxCD-watched cluster repo. write_file and delete_file produce one git commit each on the configured branch; FluxCD reconciles the change into the live cluster. Prefer this over `kubectl` for declarative changes (Deployments, Services, ConfigMaps, HelmReleases, Kustomizations). Reads run immediately; writes and deletes require operator approval.';
  readonly parameters = parameters;
  readonly parallelSafe = false;

  constructor(
    private readonly httpClient: GitHubHttpClient,
    private readonly repo: string | null,
    private readonly branch: string,
    private readonly approvalRequester?: ToolApprovalRequester,
  ) {}

  async execute(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.httpClient.enabled) {
      return {
        success: false,
        error: 'cluster_git unavailable: GITHUB_PAT is not configured',
      };
    }
    if (!this.repo) {
      return {
        success: false,
        error: 'cluster_git unavailable: CLUSTER_REPO is not configured',
      };
    }

    try {
      switch (args.operation) {
        case 'list_files':
          return await this.listFiles(args);
        case 'read_file':
          return await this.readFile(args);
        case 'write_file':
          return await this.writeFile(args, context);
        case 'delete_file':
          return await this.deleteFile(args, context);
        case 'list_commits':
          return await this.listCommits(args);
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async listFiles(args: Args): Promise<ToolExecutionResult> {
    const tree = await this.httpClient.fetchTree(this.repo!, this.branch);
    const prefix = args.pathPrefix ?? '';
    const limit = args.limit ?? LIST_FILES_DEFAULT_LIMIT;
    const filtered = (
      prefix ? tree.filter((entry) => entry.path.startsWith(prefix)) : tree
    )
      .slice(0, limit)
      .map((entry) => ({
        path: entry.path,
        sha: entry.sha,
        size: entry.size,
      }));
    return {
      success: true,
      result: {
        repo: this.repo,
        branch: this.branch,
        count: filtered.length,
        truncated: tree.length > filtered.length,
        files: filtered,
      },
    };
  }

  private async readFile(args: Args): Promise<ToolExecutionResult> {
    if (!args.path) {
      return { success: false, error: 'read_file requires `path`' };
    }
    const file = await this.httpClient.fetchFile(
      this.repo!,
      args.path,
      this.branch,
    );
    return {
      success: true,
      result: {
        repo: this.repo,
        branch: this.branch,
        path: file.path,
        sha: file.sha,
        content: file.content,
      },
    };
  }

  private async writeFile(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.path) {
      return { success: false, error: 'write_file requires `path`' };
    }
    if (args.content === undefined) {
      return { success: false, error: 'write_file requires `content`' };
    }
    const message = args.message ?? `Update ${args.path}`;
    const contentHash = createHash('sha256').update(args.content).digest('hex');

    const approvalCheck = await this.gateApproval(
      context,
      'cluster_git.write_file',
      {
        repo: this.repo!,
        branch: this.branch,
        path: args.path,
        message,
        contentHash,
      },
      `Approval required to commit ${args.path} to ${this.repo}@${this.branch}: ${message}`,
    );
    if (approvalCheck) return approvalCheck;

    let existingSha: string | undefined;
    try {
      const existing = await this.httpClient.fetchFile(
        this.repo!,
        args.path,
        this.branch,
      );
      existingSha = existing.sha;
    } catch {
      // File does not exist — create.
      existingSha = undefined;
    }

    const newSha = await this.httpClient.putFile(
      this.repo!,
      args.path,
      args.content,
      existingSha,
      message,
      this.branch,
    );

    return {
      success: true,
      result: {
        repo: this.repo,
        branch: this.branch,
        path: args.path,
        sha: newSha,
        operation: existingSha ? 'updated' : 'created',
        message,
      },
    };
  }

  private async deleteFile(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.path) {
      return { success: false, error: 'delete_file requires `path`' };
    }
    const message = args.message ?? `Delete ${args.path}`;

    const approvalCheck = await this.gateApproval(
      context,
      'cluster_git.delete_file',
      {
        repo: this.repo!,
        branch: this.branch,
        path: args.path,
        message,
      },
      `Approval required to delete ${args.path} from ${this.repo}@${this.branch}: ${message}`,
    );
    if (approvalCheck) return approvalCheck;

    let existing: GitHubFile;
    try {
      existing = await this.httpClient.fetchFile(
        this.repo!,
        args.path,
        this.branch,
      );
    } catch (err) {
      return {
        success: false,
        error: `Cannot delete ${args.path}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    await this.httpClient.deleteFile(
      this.repo!,
      args.path,
      existing.sha,
      message,
      this.branch,
    );

    return {
      success: true,
      result: {
        repo: this.repo,
        branch: this.branch,
        path: args.path,
        message,
        operation: 'deleted',
      },
    };
  }

  private async listCommits(args: Args): Promise<ToolExecutionResult> {
    const limit = args.limit ?? LIST_COMMITS_DEFAULT_LIMIT;
    const commits = await this.httpClient.listCommits(
      this.repo!,
      this.branch,
      limit,
    );
    return {
      success: true,
      result: {
        repo: this.repo,
        branch: this.branch,
        count: commits.length,
        commits,
      },
    };
  }

  private async gateApproval(
    context: ToolExecutionContext,
    actionName: string,
    args: Record<string, unknown>,
    message: string,
  ): Promise<ToolExecutionResult | null> {
    if (!this.approvalRequester) {
      return {
        success: false,
        error:
          'cluster_git mutation requires approval, but approval handling is unavailable',
      };
    }
    const approval = await this.approvalRequester.requestApproval({
      threadID: context.threadID,
      runID: context.runID,
      actionName,
      args,
      message,
    });
    if (approval.status === 'approved') return null;
    if (approval.status === 'rejected') {
      return {
        success: false,
        error: `Operator rejected${approval.feedback ? `: ${approval.feedback}` : ''}`,
      };
    }
    return {
      success: false,
      result: {
        status: 'approval_required',
        confirmationID: approval.confirmationID,
        fingerprint: approval.fingerprint,
      },
      error: `cluster_git operation requires approval (${approval.confirmationID})`,
    };
  }

  renderResultSummary(args: Args, result: unknown): string {
    const path = args.path ?? '';
    if (result == null || typeof result !== 'object') {
      return `[cluster_git] ${args.operation}${path ? ` ${path}` : ''}`;
    }
    const r = result as { count?: number; operation?: string };
    if (typeof r.count === 'number') {
      return `[cluster_git] ${args.operation} -> ${r.count} entries`;
    }
    if (r.operation) {
      return `[cluster_git] ${r.operation} ${path}`;
    }
    return `[cluster_git] ${args.operation} ${path}`;
  }
}
