import { Module } from '@nestjs/common';
import { MediaWorkflowsController } from './media-workflows.controller';
import { MediaWorkflowsService } from './media-workflows.service';
import { MediaWorkflowsGateway } from './media-workflows.gateway';

@Module({
  controllers: [MediaWorkflowsController],
  providers: [MediaWorkflowsService, MediaWorkflowsGateway],
  exports: [MediaWorkflowsService],
})
export class MediaModule {}

