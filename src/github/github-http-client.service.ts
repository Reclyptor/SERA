import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TreeEntry {
  path: string;
  sha: string;
  type: 'blob' | 'tree';
  size?: number;
}

export interface GitHubFile {
  content: string;
  sha: string;
  path: string;
}

interface TreeResponse {
  tree?: TreeEntry[];
}

interface ContentResponse {
  content?: string;
  sha?: string;
  path?: string;
}

interface PutResponse {
  content?: { sha?: string };
}

interface CommitResponse {
  sha?: string;
}

const API_BASE = 'https://api.github.com';

/**
 * Thin HTTP wrapper for the GitHub REST API endpoints SERA uses for
 * prompt/skill sync. Owns the PAT, headers, and primitive
 * fetch/put/delete operations so the higher-level sync strategies can
 * deal in `TreeEntry` and `GitHubFile` shapes without knowing the
 * transport.
 */
@Injectable()
export class GitHubHttpClient {
  private readonly logger = new Logger(GitHubHttpClient.name);
  private readonly pat: string | null;

  constructor(private readonly configService: ConfigService) {
    this.pat = this.configService.get<string>('GITHUB_PAT') ?? null;
    if (!this.pat) {
      this.logger.warn('GITHUB_PAT not set — GitHub HTTP client disabled');
    }
  }

  get enabled(): boolean {
    return this.pat !== null;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.pat}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async fetchTree(repo: string, branch = 'master'): Promise<TreeEntry[]> {
    const res = await fetch(
      `${API_BASE}/repos/${repo}/git/trees/${branch}?recursive=1`,
      {
        headers: this.headers,
      },
    );
    if (!res.ok) {
      throw new Error(
        `GitHub tree fetch failed: ${res.status} ${res.statusText}`,
      );
    }

    const data = (await res.json()) as TreeResponse;
    return (data.tree ?? []).filter((e) => e.type === 'blob');
  }

  async fetchFile(repo: string, path: string): Promise<GitHubFile> {
    const res = await fetch(
      `${API_BASE}/repos/${repo}/contents/${encodeURIComponent(path)}`,
      {
        headers: this.headers,
      },
    );
    if (!res.ok) {
      throw new Error(`GitHub file fetch failed (${path}): ${res.status}`);
    }

    const data = (await res.json()) as ContentResponse;
    const content = Buffer.from(data.content ?? '', 'base64').toString('utf-8');
    return {
      content,
      sha: data.sha ?? '',
      path: data.path ?? path,
    };
  }

  async putFile(
    repo: string,
    path: string,
    content: string,
    sha?: string,
    message?: string,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      message: message ?? `Update ${path}`,
      content: Buffer.from(content).toString('base64'),
    };
    if (sha) body.sha = sha;

    const res = await fetch(
      `${API_BASE}/repos/${repo}/contents/${encodeURIComponent(path)}`,
      {
        method: 'PUT',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (res.status === 409 && sha) {
      // SHA conflict — refetch and retry once.
      const current = await this.fetchFile(repo, path);
      return this.putFile(repo, path, content, current.sha, message);
    }

    if (!res.ok) {
      throw new Error(`GitHub putFile failed (${path}): ${res.status}`);
    }

    const data = (await res.json()) as PutResponse;
    return data.content?.sha ?? '';
  }

  async deleteFile(
    repo: string,
    path: string,
    sha: string,
    message?: string,
  ): Promise<void> {
    const res = await fetch(
      `${API_BASE}/repos/${repo}/contents/${encodeURIComponent(path)}`,
      {
        method: 'DELETE',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message ?? `Delete ${path}`,
          sha,
        }),
      },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`GitHub deleteFile failed (${path}): ${res.status}`);
    }
  }

  async getHeadSha(repo: string, branch = 'master'): Promise<string> {
    const res = await fetch(`${API_BASE}/repos/${repo}/commits/${branch}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`GitHub HEAD fetch failed: ${res.status}`);
    const data = (await res.json()) as CommitResponse;
    return data.sha ?? '';
  }
}
