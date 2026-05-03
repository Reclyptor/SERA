import { Global, Module } from '@nestjs/common';
import { GitHubSyncService } from './github-sync.service';

@Global()
@Module({
  providers: [GitHubSyncService],
  exports: [GitHubSyncService],
})
export class GitHubModule {}
