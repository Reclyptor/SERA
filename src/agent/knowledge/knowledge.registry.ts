import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeProvider } from './knowledge.interface';

@Injectable()
export class KnowledgeRegistry {
  private readonly logger = new Logger(KnowledgeRegistry.name);
  private readonly providers = new Map<string, KnowledgeProvider>();

  registerProvider(provider: KnowledgeProvider): void {
    this.providers.set(provider.name, provider);
    this.logger.log(`Registered knowledge provider: ${provider.name}`);
  }

  getProvider(name: string): KnowledgeProvider | undefined {
    return this.providers.get(name);
  }

  getAllProviders(): KnowledgeProvider[] {
    return Array.from(this.providers.values());
  }
}
