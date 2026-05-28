import { Global, Module } from '@nestjs/common';
import { GitHubHttpClient } from './github-http-client.service';
import { GitHubShaTracker } from './github-sha-tracker.service';

@Global()
@Module({
  providers: [GitHubHttpClient, GitHubShaTracker],
  exports: [GitHubHttpClient, GitHubShaTracker],
})
export class GitHubModule {}
