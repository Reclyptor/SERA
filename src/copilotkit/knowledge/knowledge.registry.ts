import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeProvider, ReadableContext } from './interfaces/knowledge.interface';

@Injectable()
export class KnowledgeRegistry {
  private readonly logger = new Logger(KnowledgeRegistry.name);
  private readonly providers = new Map<string, KnowledgeProvider>();
  private readonly readables = new Map<string, ReadableContext>();

  // Provider management

  registerProvider(provider: KnowledgeProvider): void {
    this.providers.set(provider.name, provider);
    this.logger.log(`Registered knowledge provider: ${provider.name}`);
  }

  unregisterProvider(name: string): boolean {
    return this.providers.delete(name);
  }

  getProvider(name: string): KnowledgeProvider | undefined {
    return this.providers.get(name);
  }

  getAllProviders(): KnowledgeProvider[] {
    return Array.from(this.providers.values());
  }

  // Readable context management (from frontend useCopilotReadable)

  /**
   * Sync readable contexts from frontend
   * Called when frontend sends its readable state
   */
  syncReadables(readables: ReadableContext[]): void {
    this.readables.clear();
    for (const readable of readables) {
      this.readables.set(readable.id, readable);
    }
    this.logger.debug(`Synced ${readables.length} readable contexts`);
  }

  setReadable(readable: ReadableContext): void {
    this.readables.set(readable.id, readable);
  }

  removeReadable(id: string): boolean {
    return this.readables.delete(id);
  }

  getReadable(id: string): ReadableContext | undefined {
    return this.readables.get(id);
  }

  getAllReadables(): ReadableContext[] {
    return Array.from(this.readables.values());
  }

  getReadablesByCategory(category: string): ReadableContext[] {
    return this.getAllReadables().filter(
      (r) => r.categories?.includes(category),
    );
  }
}
