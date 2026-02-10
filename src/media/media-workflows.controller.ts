import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MediaWorkflowsService } from './media-workflows.service';
import type { ReviewDecisionDto } from './media-workflows.service';
import { ChatsService } from '../chats/chats.service';
import { CurrentUser } from '../auth/user.decorator';
import type { SessionUser } from '../auth/session.strategy';

@Controller('workflows')
export class MediaWorkflowsController {
  constructor(
    private readonly mediaWorkflowsService: MediaWorkflowsService,
    private readonly chatsService: ChatsService,
  ) {}

  @Get(':workflowId')
  getWorkflowDescription(@Param('workflowId') workflowId: string) {
    return this.mediaWorkflowsService.getWorkflowDescription(workflowId);
  }

  @Get(':workflowId/progress')
  getWorkflowProgress(@Param('workflowId') workflowId: string) {
    return this.mediaWorkflowsService.getWorkflowProgress(workflowId);
  }

  @Get('folder/:workflowId/progress')
  getFolderProgress(@Param('workflowId') workflowId: string) {
    return this.mediaWorkflowsService.getFolderProgress(workflowId);
  }

  @Get('folder/:workflowId/reviews')
  getPendingReviews(@Param('workflowId') workflowId: string) {
    return this.mediaWorkflowsService.getPendingReviews(workflowId);
  }

  @Post('folder/:workflowId/reviews')
  submitReviewDecision(
    @Param('workflowId') workflowId: string,
    @Body() decision: ReviewDecisionDto,
  ) {
    return this.mediaWorkflowsService.submitReviewDecision(workflowId, decision);
  }

  @Get('thread/:threadId/state')
  async getThreadWorkflowState(
    @Param('threadId') threadId: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.chatsService.findOne(threadId, user.sub);
    return this.mediaWorkflowsService.getThreadWorkflowState(threadId);
  }

  @Post('thread/:threadId/:workflowId/cancel')
  async cancelWorkflow(
    @Param('threadId') threadId: string,
    @Param('workflowId') workflowId: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.chatsService.findOne(threadId, user.sub);
    return this.mediaWorkflowsService.cancelWorkflow(threadId, workflowId);
  }

  // Convenience endpoint if you want to trigger a dummy workflow without chat.
  @Post('dummy/start')
  startDummyWorkflow() {
    const workflowId = this.mediaWorkflowsService.startDummyWorkflow();
    return {
      workflowId,
      message: `Dummy workflow started. Workflow ID: ${workflowId}`,
    };
  }
}

