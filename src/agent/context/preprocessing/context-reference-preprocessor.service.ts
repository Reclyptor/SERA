import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenCounterService } from '../tokens/token-counter.service';
import { ModelContextWindowService } from '../tokens/model-context-window.service';
import { ContextEventEmitterService } from '../events/context-event-emitter.service';
import { FileReferenceResolver } from './reference-resolvers/file.resolver';
import { DiffReferenceResolver } from './reference-resolvers/diff.resolver';
import { UrlReferenceResolver } from './reference-resolvers/url.resolver';

const REFERENCE_PATTERN = /@(diff|staged)\b|@(file|folder|url|git):(\S+)/g;

const REFERENCE_BUDGET_RATIO = 0.2;
const OMITTED_PLACEHOLDER = '[Reference omitted: token budget exceeded]';

export interface PreprocessContext {
  runID: string;
  threadID: string;
  provider: string;
  modelID: string;
  workspaceDir: string;
}

export interface PreprocessResult {
  message: string;
  expansions: number;
  budgetExceeded: boolean;
}

interface ParsedRef {
  raw: string;
  kind: 'file' | 'folder' | 'diff' | 'staged' | 'git' | 'url';
  target: string;
  start: number;
  end: number;
}

@Injectable()
export class ContextReferencePreprocessorService {
  private readonly logger = new Logger(
    ContextReferencePreprocessorService.name,
  );

  constructor(
    private readonly configService: ConfigService,
    private readonly tokenCounter: TokenCounterService,
    private readonly modelContextWindow: ModelContextWindowService,
    private readonly events: ContextEventEmitterService,
    private readonly fileResolver: FileReferenceResolver,
    private readonly diffResolver: DiffReferenceResolver,
    private readonly urlResolver: UrlReferenceResolver,
  ) {}

  isEnabled(): boolean {
    return (
      (this.configService.get<string>('CONTEXT_REFERENCES_ENABLED') ?? '')
        .toString()
        .toLowerCase() === 'true'
    );
  }

  async preprocess(
    message: string,
    ctx: PreprocessContext,
  ): Promise<PreprocessResult> {
    if (!this.isEnabled() || !message) {
      return { message, expansions: 0, budgetExceeded: false };
    }
    const refs = this.parse(message);
    if (refs.length === 0) {
      return { message, expansions: 0, budgetExceeded: false };
    }

    const window = this.modelContextWindow.get(ctx.provider, ctx.modelID);
    const budgetTokens = Math.floor(window * REFERENCE_BUDGET_RATIO);

    let injectedTokens = 0;
    let budgetExceeded = false;
    let expansions = 0;

    // Walk in source order so the resulting string keeps the user's flow.
    const pieces: string[] = [];
    let cursor = 0;
    for (const ref of refs) {
      pieces.push(message.slice(cursor, ref.start));
      cursor = ref.end;

      if (budgetExceeded) {
        pieces.push(OMITTED_PLACEHOLDER);
        continue;
      }

      const expansion = await this.resolve(ref, ctx).catch((err) => {
        this.logger.warn(
          `Failed to resolve ${ref.raw}: ${(err as Error).message}`,
        );
        return `[${ref.raw}: resolve failed]`;
      });

      const tokens = this.tokenCounter.count(expansion, ctx.provider);
      if (injectedTokens + tokens > budgetTokens) {
        budgetExceeded = true;
        pieces.push(OMITTED_PLACEHOLDER);
        continue;
      }
      injectedTokens += tokens;
      expansions += 1;
      pieces.push(expansion);
      void this.events.emitReferenceExpanded(ctx.runID, ctx.threadID, {
        kind: ref.kind,
        target: ref.target,
        injectedTokens: tokens,
      });
    }
    pieces.push(message.slice(cursor));

    return {
      message: pieces.join(''),
      expansions,
      budgetExceeded,
    };
  }

  private parse(message: string): ParsedRef[] {
    const refs: ParsedRef[] = [];
    let match: RegExpExecArray | null;
    REFERENCE_PATTERN.lastIndex = 0;
    while ((match = REFERENCE_PATTERN.exec(message)) !== null) {
      const simple = match[1] as 'diff' | 'staged' | undefined;
      if (simple) {
        refs.push({
          raw: match[0],
          kind: simple,
          target: simple,
          start: match.index,
          end: match.index + match[0].length,
        });
        continue;
      }
      const kind = match[2] as ParsedRef['kind'];
      const target = match[3].replace(/[.,;!?]$/, '');
      refs.push({
        raw: match[0],
        kind,
        target,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    return refs;
  }

  private async resolve(
    ref: ParsedRef,
    ctx: PreprocessContext,
  ): Promise<string> {
    switch (ref.kind) {
      case 'file':
      case 'folder': {
        const { text } = await this.fileResolver.resolve({
          target: ref.target,
          workspaceDir: ctx.workspaceDir,
        });
        return text;
      }
      case 'diff': {
        const { text } = await this.diffResolver.resolve({
          workspaceDir: ctx.workspaceDir,
        });
        return text;
      }
      case 'staged': {
        const { text } = await this.diffResolver.resolve({
          workspaceDir: ctx.workspaceDir,
          staged: true,
        });
        return text;
      }
      case 'git': {
        const { text } = await this.diffResolver.resolve({
          workspaceDir: ctx.workspaceDir,
          ref: ref.target,
        });
        return text;
      }
      case 'url': {
        const { text } = await this.urlResolver.resolve({ url: ref.target });
        return text;
      }
      default:
        return ref.raw;
    }
  }
}
