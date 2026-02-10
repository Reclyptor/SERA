import { Module } from '@nestjs/common';
import { MediaWorkflowsController } from './media-workflows.controller';
import { MediaWorkflowsService } from './media-workflows.service';
import { MediaWorkflowsGateway } from './media-workflows.gateway';
import { ChatsModule } from '../chats/chats.module';

@Module({
  imports: [ChatsModule],
  controllers: [MediaWorkflowsController],
  providers: [MediaWorkflowsService, MediaWorkflowsGateway],
  exports: [MediaWorkflowsService],
})
export class MediaModule {}

