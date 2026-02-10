import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MediaWorkflowsService } from './media-workflows.service';
import type { ReviewDecisionDto } from './media-workflows.service';

@Controller('media/workflows')
export class MediaWorkflowsController {
  constructor(private readonly mediaWorkflowsService: MediaWorkflowsService) {}

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

