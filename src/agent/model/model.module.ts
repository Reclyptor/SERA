import { Module } from '@nestjs/common';
import { ModelRouterService } from './model-router.service';
import { PromptCacheService } from './prompt-cache.service';
import { CredentialPoolService } from './credential-pool.service';
import { ModelsModule } from '../../models/models.module';

@Module({
  imports: [ModelsModule],
  providers: [ModelRouterService, PromptCacheService, CredentialPoolService],
  exports: [ModelRouterService, PromptCacheService, CredentialPoolService],
})
export class ModelModule {}
