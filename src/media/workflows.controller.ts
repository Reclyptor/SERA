import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import type {
  ReviewDecisionDto,
  DetectionConfirmationDto,
} from './workflows.service';
import { ChatsService } from '../chats/chats.service';
import { CurrentUser } from '../auth/user.decorator';
import type { SessionUser } from '../auth/session.strategy';

@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly chatsService: ChatsService,
  ) {}

  @Get('series-roots')
  listSeriesRoots() {
    return this.workflowsService.listSeriesRoots();
  }

  @Get(':workflowId')
  getWorkflowDescription(@Param('workflowId') workflowId: string) {
    return this.workflowsService.getWorkflowDescription(workflowId);
  }

  @Get(':workflowId/progress')
  getWorkflowProgress(@Param('workflowId') workflowId: string) {
    return this.workflowsService.getWorkflowProgress(workflowId);
  }

  @Get(':workflowId/staging-tree')
  getStagingTree(@Param('workflowId') workflowId: string) {
    return this.workflowsService.getStagingTree(workflowId);
  }

  @Get('folder/:workflowId/progress')
  getFolderProgress(@Param('workflowId') workflowId: string) {
    return this.workflowsService.getFolderProgress(workflowId);
  }

  @Get('folder/:workflowId/reviews')
  getPendingReviews(@Param('workflowId') workflowId: string) {
    return this.workflowsService.getPendingReviews(workflowId);
  }

  @Post('folder/:workflowId/reviews')
  submitReviewDecision(
    @Param('workflowId') workflowId: string,
    @Body() decision: ReviewDecisionDto,
  ) {
    return this.workflowsService.submitReviewDecision(workflowId, decision);
  }

  @Get('thread/:threadId/state')
  async getThreadWorkflowState(
    @Param('threadId') threadId: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.chatsService.findOne(threadId, user.sub);
    return this.workflowsService.getThreadWorkflowState(threadId);
  }

  @Post('thread/:threadId/:workflowId/cancel')
  async cancelWorkflow(
    @Param('threadId') threadId: string,
    @Param('workflowId') workflowId: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.chatsService.findOne(threadId, user.sub);
    return this.workflowsService.cancelWorkflow(threadId, workflowId);
  }

  @Post('thread/:threadId/start')
  async startWorkflowForThread(
    @Param('threadId') threadId: string,
    @Body() payload: { seriesRootPath: string },
    @CurrentUser() user: SessionUser,
  ) {
    await this.chatsService.findOne(threadId, user.sub);
    return this.workflowsService.startWorkflowForThread(
      threadId,
      payload.seriesRootPath,
    );
  }

  @Post('thread/:threadId/:workflowId/finalize')
  async finalizeWorkflowForThread(
    @Param('threadId') threadId: string,
    @Param('workflowId') workflowId: string,
    @Body() body: { approved?: boolean },
    @CurrentUser() user: SessionUser,
  ) {
    await this.chatsService.findOne(threadId, user.sub);
    return this.workflowsService.finalizeWorkflow(
      threadId,
      workflowId,
      body.approved ?? true,
    );
  }

  @Post('folder/:workflowId/confirm-detection')
  confirmDetection(
    @Param('workflowId') workflowId: string,
    @Body() confirmation: DetectionConfirmationDto,
  ) {
    return this.workflowsService.confirmDetection(workflowId, confirmation);
  }

  @Post('thread/:threadId/:workflowId/sync')
  async syncWorkflowProgress(
    @Param('threadId') threadId: string,
    @Param('workflowId') workflowId: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.chatsService.findOne(threadId, user.sub);
    await this.workflowsService.syncWorkflowProgress(threadId, workflowId);
    return { success: true };
  }
}
