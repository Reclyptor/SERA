import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeRegistry } from './knowledge.registry';
import {
  ContextItem,
  KnowledgeDocument,
  KnowledgeProvider,
  KnowledgeQuery,
  KnowledgeResult,
} from './knowledge.interface';

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(private readonly registry: KnowledgeRegistry) {}

  registerProvider(provider: KnowledgeProvider): void {
    this.registry.registerProvider(provider);
  }

  /**
   * Search across all registered knowledge providers
   */
  async search(query: KnowledgeQuery): Promise<KnowledgeResult[]> {
    const providers = this.registry.getAllProviders();
    if (providers.length === 0) {
      this.logger.debug('No knowledge providers registered');
      return [];
    }

    const results: KnowledgeResult[] = [];

    await Promise.all(
      providers.map(async (provider) => {
        try {
          const providerResults = await provider.search(query);
          results.push(...providerResults);
        } catch (error) {
          this.logger.error(
            `Knowledge search failed for provider ${provider.name}:`,
            error,
          );
        }
      }),
    );

    results.sort((a, b) => b.score - a.score);
    return query.limit ? results.slice(0, query.limit) : results;
  }

  /**
   * Search a specific provider
   */
  async searchProvider(
    providerName: string,
    query: KnowledgeQuery,
  ): Promise<KnowledgeResult[]> {
    const provider = this.registry.getProvider(providerName);
    if (!provider) {
      this.logger.warn(`Knowledge provider not found: ${providerName}`);
      return [];
    }

    try {
      return await provider.search(query);
    } catch (error) {
      this.logger.error(
        `Knowledge search failed for provider ${providerName}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Add a document to a specific provider
   */
  async addDocument(
    providerName: string,
    document: Omit<KnowledgeDocument, 'id'>,
  ): Promise<KnowledgeDocument | null> {
    const provider = this.registry.getProvider(providerName);
    if (!provider?.addDocument) {
      this.logger.warn(
        `Provider ${providerName} does not support document addition`,
      );
      return null;
    }

    try {
      return await provider.addDocument(document);
    } catch (error) {
      this.logger.error(`Failed to add document to ${providerName}:`, error);
      return null;
    }
  }

  /**
   * Build context for LLM from knowledge search
   */
  async buildContext(
    query: string,
    options?: {
      maxKnowledgeResults?: number;
    },
  ): Promise<ContextItem[]> {
    const context: ContextItem[] = [];
    const { maxKnowledgeResults = 5 } = options ?? {};

    if (query && maxKnowledgeResults > 0) {
      const results = await this.search({
        query,
        limit: maxKnowledgeResults,
      });

      for (const result of results) {
        context.push({
          id: result.chunk.chunkID,
          content: result.chunk.content,
          type: 'document',
          priority: Math.round(result.score * 100),
          metadata: {
            documentID: result.chunk.documentID,
            source: result.document?.source,
            score: result.score,
          },
        });
      }
    }

    context.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return context;
  }

  /**
   * Format context items into a string for LLM system prompt
   */
  formatContextForPrompt(context: ContextItem[]): string {
    if (context.length === 0) {
      return '';
    }

    const sections: string[] = [];

    const documents = context.filter((c) => c.type === 'document');
    if (documents.length > 0) {
      sections.push(
        '## Relevant Knowledge\n' +
          documents.map((d) => d.content).join('\n\n---\n\n'),
      );
    }

    const stateItems = context.filter((c) => c.type === 'state');
    if (stateItems.length > 0) {
      sections.push(
        '## Current State\n' + stateItems.map((s) => s.content).join('\n'),
      );
    }

    return sections.join('\n\n');
  }
}
