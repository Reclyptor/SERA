import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KnowledgeService } from './knowledge.service';
import { DocumentKnowledgeProvider } from './providers';

@Injectable()
export class KnowledgeBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeBootstrapService.name);

  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const qdrantUrl = this.configService.get<string>(
      'QDRANT_URL',
      'http://qdrant.qdrant.svc.cluster.local:6333',
    );

    const embeddingModel = this.configService.get<string>(
      'OPENAI_EMBEDDING_MODEL',
      'text-embedding-3-small',
    );
    const embeddingDimension =
      embeddingModel === 'text-embedding-3-large' ? 3072 : 1536;

    const chunkSize = parseInt(
      this.configService.get<string>('KNOWLEDGE_CHUNK_SIZE', '1000'),
      10,
    );

    const chunkOverlap = parseInt(
      this.configService.get<string>('KNOWLEDGE_CHUNK_OVERLAP', '200'),
      10,
    );

    const qdrantApiKey = this.configService.get<string>('QDRANT_API_KEY');

    this.knowledgeService.registerProvider(
      new DocumentKnowledgeProvider({
        qdrantUrl,
        qdrantApiKey,
        openaiApiKey: this.configService.get<string>('OPENAI_API_KEY'),
        embeddingModel,
        embeddingDimension,
        chunkSize,
        chunkOverlap,
      }),
    );

    this.logger.log(
      `Registered document knowledge provider (Qdrant: ${qdrantUrl})`,
    );
  }
}
