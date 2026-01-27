import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeRegistry } from './knowledge.registry';
import {
  ContextItem,
  KnowledgeDocument,
  KnowledgeProvider,
  KnowledgeQuery,
  KnowledgeResult,
  ReadableContext,
} from './interfaces/knowledge.interface';

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(private readonly registry: KnowledgeRegistry) {}

  // Provider management

  registerProvider(provider: KnowledgeProvider): void {
    this.registry.registerProvider(provider);
  }

  // Readable context (from frontend)

  syncReadables(readables: ReadableContext[]): void {
    this.registry.syncReadables(readables);
  }

  getAllReadables(): ReadableContext[] {
    return this.registry.getAllReadables();
  }

  // Knowledge search

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

    // Sort by score descending and limit
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

  // Document management

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

  // Context building

  /**
   * Build context for LLM from readables and knowledge search
   */
  async buildContext(
    query: string,
    options?: {
      includeReadables?: boolean;
      maxKnowledgeResults?: number;
      categories?: string[];
    },
  ): Promise<ContextItem[]> {
    const context: ContextItem[] = [];
    const {
      includeReadables = true,
      maxKnowledgeResults = 5,
      categories,
    } = options ?? {};

    // Add readable contexts
    if (includeReadables) {
      const readables = categories
        ? categories.flatMap((c) => this.registry.getReadablesByCategory(c))
        : this.registry.getAllReadables();

      for (const readable of readables) {
        context.push({
          id: readable.id,
          content: `${readable.description}: ${JSON.stringify(readable.value)}`,
          type: 'readable',
          priority: 100,
          metadata: { categories: readable.categories },
        });
      }
    }

    // Search knowledge base
    if (query && maxKnowledgeResults > 0) {
      const results = await this.search({
        query,
        limit: maxKnowledgeResults,
      });

      for (const result of results) {
        context.push({
          id: result.chunk.chunkId,
          content: result.chunk.content,
          type: 'document',
          priority: Math.round(result.score * 100),
          metadata: {
            documentId: result.chunk.documentId,
            source: result.document?.source,
            score: result.score,
          },
        });
      }
    }

    // Sort by priority
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

    const readables = context.filter((c) => c.type === 'readable');
    if (readables.length > 0) {
      sections.push(
        '## Current Application State\n' +
          readables.map((r) => r.content).join('\n'),
      );
    }

    const documents = context.filter((c) => c.type === 'document');
    if (documents.length > 0) {
      sections.push(
        '## Relevant Knowledge\n' +
          documents.map((d) => d.content).join('\n\n---\n\n'),
      );
    }

    return sections.join('\n\n');
  }
}
