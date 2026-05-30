import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Res,
  BadRequestException,
  NotFoundException,
  UploadedFile,
  UseInterceptors,
  Logger,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { OrchestratorService } from './orchestration/orchestrator.service';
import { AgentEventEmitter } from './streaming/agent-event-emitter';
import { RunStreamService } from './streaming/run-stream.service';
import { StateService } from './state/state.service';
import { ConfirmationSignalService } from './state/confirmation-signal.service';
import { AgentRouterService } from '../agents/agent-router.service';
import { AgentsService } from '../agents/agents.service';
import { AttachmentsService } from './attachments/attachments.service';
import {
  serializeAttachment,
  type AttachmentResponseDto,
} from './attachments/attachment.dto';
import { ChatsService } from '../chats/chats.service';
import { ModelRouterService } from './model/model-router.service';
import type { SessionUser } from '../auth/session.strategy';
import type { OrchestratorConfig } from './orchestration/orchestration.interfaces';

interface ChatRequestBody {
  message: string;
  attachmentIDs?: string[];
  chatID?: string;
  threadID?: string;
  agentID?: string;
  model?: string;
  config?: Partial<OrchestratorConfig>;
}

interface ChatResponse {
  runID: string;
  threadID: string;
  chatID: string;
}

@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly eventEmitter: AgentEventEmitter,
    private readonly runStream: RunStreamService,
    private readonly stateService: StateService,
    private readonly confirmationSignal: ConfirmationSignalService,
    private readonly agentRouter: AgentRouterService,
    private readonly agentsService: AgentsService,
    private readonly attachmentsService: AttachmentsService,
    private readonly chatsService: ChatsService,
    private readonly modelRouter: ModelRouterService,
  ) {}

  @Post('chat')
  async chat(
    @Req() req: Request,
    @Body() body: ChatRequestBody,
  ): Promise<ChatResponse> {
    const user = (req as Request & { user?: SessionUser }).user;
    const userID = user?.sub;
    if (!userID) {
      throw new BadRequestException('Authentication required');
    }

    const attachmentIDs = body.attachmentIDs ?? [];
    const messageText = body.message?.trim() || '';

    if (!messageText && attachmentIDs.length === 0) {
      throw new BadRequestException('Message or attachment is required');
    }

    const attachments = await this.attachmentsService.findManyByIDsForUser(
      attachmentIDs,
      userID,
    );

    const threadID = body.threadID ?? crypto.randomUUID();
    const runID = crypto.randomUUID();
    const messageID = crypto.randomUUID();

    const userMessage = {
      id: messageID,
      role: 'user' as const,
      content: messageText,
      attachments: attachments.map((attachment) => ({
        id: attachment.attachmentID,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        size: attachment.size,
        filename: attachment.filename,
        createdAt: attachment.createdAt,
      })),
      createdAt: new Date(),
    };

    // Upfront catalog validation so a stale picker selection fails fast with
    // 400 instead of producing a run that dies on first model call.
    if (body.model && !(await this.modelRouter.isValidModel(body.model))) {
      throw new BadRequestException(
        `Model "${body.model}" is unknown or disabled`,
      );
    }
    if (
      body.agentID &&
      !(await this.agentsService.isValidActiveAgent(body.agentID))
    ) {
      throw new BadRequestException(
        `Agent "${body.agentID}" is unknown or disabled`,
      );
    }

    let chatID: string;
    let stickyAgentID: string | undefined;
    if (body.chatID) {
      chatID = body.chatID;
      const chat = await this.chatsService.findOne(chatID, userID);
      stickyAgentID = chat.agentID;
      await this.chatsService.appendMessage(chatID, userID, userMessage);
      if (body.model) {
        await this.chatsService.updateModel(chatID, body.model);
      }
      if (body.agentID) {
        await this.chatsService.updateAgent(chatID, body.agentID);
        stickyAgentID = body.agentID;
      }
    } else {
      const chat = await this.chatsService.createWithUserMessage(
        userID,
        userMessage,
        { model: body.model, agentID: body.agentID },
      );
      chatID = String(chat._id);
      stickyAgentID = chat.agentID;
    }

    await this.attachmentsService.bindToMessage({
      attachmentIDs,
      userID,
      chatID,
      messageID,
    });

    const agentID =
      body.agentID ??
      stickyAgentID ??
      (await this.agentRouter.resolve({ userID, chatID, threadID }));

    if (!agentID) {
      throw new BadRequestException(
        'No agent could be resolved. Ensure a default agent binding exists.',
      );
    }

    this.orchestrator
      .executeGoal(
        {
          threadID,
          runID,
          userID,
          userName: user?.name,
          chatID,
          agentID,
          userMessage: messageText,
          conversationHistory: [],
          modelOptions: body.model ? { preferredModel: body.model } : undefined,
        },
        body.config,
      )
      .catch((error) => {
        this.logger.error(`Unhandled error in run ${runID}:`, error);
      });

    return { runID, threadID, chatID };
  }

  @Get('stream/:runID')
  streamRun(
    @Param('runID') runID: string,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const queryLastEventID = req.query['last-event-id'];
    const headerLastEventID = req.headers['last-event-id'];
    // Query param wins when both present — explicit client retry should
    // override the browser's auto-replayed Last-Event-ID header.
    const lastEventID =
      (Array.isArray(queryLastEventID)
        ? queryLastEventID[0]
        : queryLastEventID) ??
      (Array.isArray(headerLastEventID)
        ? headerLastEventID[0]
        : headerLastEventID);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const subscription = this.runStream
      .createReconnectionObservable(
        runID,
        typeof lastEventID === 'string' ? lastEventID : '0',
      )
      .subscribe({
        next: (frame) => {
          if (frame.kind === 'comment') {
            res.write(`: ${frame.text}\n\n`);
          } else {
            res.write(`id: ${frame.id}\ndata: ${frame.data}\n\n`);
          }
        },
        error: (err) => {
          this.logger.error(`SSE stream error for run ${runID}:`, err);
          res.end();
        },
        complete: () => {
          res.end();
        },
      });

    req.on('close', () => {
      subscription.unsubscribe();
    });
  }

  @Get('active-run/:chatID')
  async getActiveRun(
    @Param('chatID') chatID: string,
    @Req() req: Request,
  ): Promise<{ runID: string; threadID: string }> {
    const userID = (req as Request & { user?: SessionUser }).user?.sub;
    if (!userID) {
      throw new BadRequestException('Authentication required');
    }

    await this.chatsService.findOne(chatID, userID);

    const activeRun = await this.runStream.getActiveRun(chatID);
    if (!activeRun) {
      throw new NotFoundException('No active run for this chat');
    }
    return activeRun;
  }

  /**
   * Cancel a running execution.
   */
  @Post('cancel/:runID')
  async cancel(@Param('runID') runID: string): Promise<{ cancelled: boolean }> {
    const cancelled = await this.orchestrator.cancelRun(runID);
    return { cancelled };
  }

  /**
   * Resolve a pending confirmation (approve or reject).
   */
  @Post('confirm/:threadID/:confirmationID')
  async confirm(
    @Param('threadID') threadID: string,
    @Param('confirmationID') confirmationID: string,
    @Body() body: { approved: boolean; feedback?: string },
    @Req() req: Request,
  ): Promise<{ resolved: boolean }> {
    const userID = (req as Request & { user?: SessionUser }).user?.sub;

    const confirmation = await this.stateService.getConfirmation(
      threadID,
      confirmationID,
    );
    if (!confirmation) {
      return { resolved: false };
    }

    const resolved = await this.stateService.resolveConfirmation(
      threadID,
      confirmationID,
      {
        approved: body.approved,
        feedback: body.feedback,
        resolvedBy: userID,
      },
    );

    if (resolved && confirmation.runID) {
      // Wake any backend wait via the ConfirmationSignal bus. Whichever
      // pod is holding `RequestConfirmationAction.execute` for this
      // confirmation receives the published decision and unblocks
      // without polling Mongo. The Mongo write above is the system of
      // record; this pub is only the wake-up wire.
      await this.confirmationSignal.publish(threadID, confirmationID, {
        status: body.approved ? 'approved' : 'rejected',
        feedback: body.feedback,
      });

      // Emit BOTH event channels: `confirmation.resolved` is the
      // historical name for action-side confirmations (request_confirmation
      // action, memory-management approvals) and `approval.resolved` is
      // the SPEC §29.6 name for tool-side approvals (exec/shell/process/
      // code_execution). The underlying store is unified, so consumers
      // match by confirmationID against whichever .required/.requested
      // event they originally observed.
      await this.eventEmitter.emitEvent(
        confirmation.runID,
        threadID,
        'confirmation.resolved',
        {
          confirmationID,
          approved: body.approved,
        },
      );
      await this.eventEmitter.emitEvent(
        confirmation.runID,
        threadID,
        'approval.resolved',
        {
          confirmationID,
          approved: body.approved,
          actionName: confirmation.actionName,
        },
      );
    }

    return { resolved };
  }

  /**
   * Get a state snapshot for a thread.
   */
  @Get('state/:threadID')
  async getState(@Param('threadID') threadID: string) {
    return this.stateService.getSnapshot(threadID);
  }

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<AttachmentResponseDto> {
    const userID = (req as Request & { user?: SessionUser }).user?.sub;
    if (!userID) {
      throw new BadRequestException('Authentication required');
    }

    const attachment = await this.attachmentsService.createFromUpload(
      file,
      userID,
    );

    return serializeAttachment(attachment);
  }

  @Get('attachments/:attachmentID/content')
  async getAttachmentContent(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('attachmentID') attachmentID: string,
  ): Promise<StreamableFile> {
    const userID = (req as Request & { user?: SessionUser }).user?.sub;
    if (!userID) {
      throw new BadRequestException('Authentication required');
    }

    const { attachment, data } =
      await this.attachmentsService.getContentForUser(attachmentID, userID);

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${(attachment.filename ?? attachment.attachmentID).replace(/"/g, '')}"`,
    );

    return new StreamableFile(data);
  }
}
