import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModelModule } from '../model/model.module';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { QdrantMemoryBackend } from './backend/qdrant-memory.backend';
import { MEMORY_BACKEND } from './backend/memory-backend.interface';
import { MemoryScorer } from './scoring/memory-scorer';
import { MemoryReranker } from './reranker/memory-reranker';
import { MemoryConsolidatorService } from './lifecycle/memory-consolidator.service';

@Module({
  imports: [ConfigModule, ModelModule],
  controllers: [MemoryController],
  providers: [
    {
      provide: MEMORY_BACKEND,
      useClass: QdrantMemoryBackend,
    },
    MemoryScorer,
    MemoryReranker,
    MemoryService,
    MemoryConsolidatorService,
  ],
  exports: [MemoryService],
})
export class MemoryModule {}
