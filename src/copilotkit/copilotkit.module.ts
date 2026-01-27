import { Module } from '@nestjs/common';
import { CopilotKitController } from './copilotkit.controller';
import { CopilotKitService } from './copilotkit.service';

@Module({
  controllers: [CopilotKitController],
  providers: [CopilotKitService],
  exports: [CopilotKitService],
})
export class CopilotKitModule {}
