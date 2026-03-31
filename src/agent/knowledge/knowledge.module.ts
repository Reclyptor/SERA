import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KnowledgeRegistry } from './knowledge.registry';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeBootstrapService } from './knowledge-bootstrap.service';

@Module({
  imports: [ConfigModule],
  providers: [KnowledgeRegistry, KnowledgeService, KnowledgeBootstrapService],
  exports: [KnowledgeService, KnowledgeRegistry],
})
export class KnowledgeModule {}
