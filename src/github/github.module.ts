import { Global, Module } from '@nestjs/common';
import { GitHubSyncService } from './github-sync.service';
import { GitHubHttpClient } from './github-http-client.service';
import { GitHubShaTracker } from './github-sha-tracker.service';

@Global()
@Module({
  providers: [GitHubHttpClient, GitHubShaTracker, GitHubSyncService],
  exports: [GitHubSyncService, GitHubHttpClient, GitHubShaTracker],
})
export class GitHubModule {}
