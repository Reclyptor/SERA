import { Module } from '@nestjs/common';
import { SandboxRunnerService } from './sandbox-runner.service';

@Module({
  providers: [SandboxRunnerService],
  exports: [SandboxRunnerService],
})
export class SandboxModule {}
