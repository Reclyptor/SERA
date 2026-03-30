import { Module } from '@nestjs/common';
import { KnowledgeRegistry } from './knowledge.registry';
import { KnowledgeService } from './knowledge.service';

@Module({
  providers: [KnowledgeRegistry, KnowledgeService],
  exports: [KnowledgeService, KnowledgeRegistry],
})
export class KnowledgeModule {}
