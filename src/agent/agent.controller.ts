import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Sse,
  BadRequestException,
  NotFoundException,
  UploadedFile,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import { OrchestratorService } from './orchestration/orchestrator.service';
import { AgentEventEmitter } from './streaming/agent-event-emitter';
import { RunStreamService } from './streaming/run-stream.service';
import { StateService } from './state/state.service';
import { AgentRouterService } from '../agents/agent-router.service';
import { ImageStorage } from './storage/image.storage';
import { ChatsService } from '../chats/chats.service';
import type { UploadImageResponseDto } from './upload-image.dto';
import type { SessionUser } from '../auth/session.strategy';
import type { OrchestratorConfig } from './orchestration/orchestration.interfaces';

interface ChatRequestBody {
  message: string;
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
    private readonly agentRouter: AgentRouterService,
    private readonly imageStorage: ImageStorage,
    private readonly chatsService: ChatsService,
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

    if (!body.message?.trim()) {
      throw new BadRequestException('Message is required');
    }

    const threadID = body.threadID ?? crypto.randomUUID();
    const runID = crypto.randomUUID();

    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: body.message,
      createdAt: new Date(),
    };

    let chatID: string;
    if (body.chatID) {
      chatID = body.chatID;
      await this.chatsService.findOne(chatID, userID);
      await this.chatsService.appendMessage(chatID, userMessage);
      if (body.model) {
        await this.chatsService.updateModel(chatID, body.model);
      }
    } else {
      const chat = await this.chatsService.createWithUserMessage(
        userID,
        userMessage,
        body.model,
      );
      chatID = String(chat._id);
    }

    const agentID =
      body.agentID ??
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
          userMessage: body.message,
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

  @Sse('stream/:runID')
  streamRun(
    @Param('runID') runID: string,
    @Req() req: Request,
  ): Observable<MessageEvent> {
    const headerLastEventID = req.headers['last-event-id'];
    const queryLastEventID = req.query['last-event-id'];
    const lastEventID =
      (Array.isArray(headerLastEventID)
        ? headerLastEventID[0]
        : headerLastEventID) ??
      (Array.isArray(queryLastEventID)
        ? queryLastEventID[0]
        : queryLastEventID);

    return this.runStream.createReconnectionObservable(
      runID,
      typeof lastEventID === 'string' ? lastEventID : '0',
    ) as Observable<MessageEvent>;
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
      await this.eventEmitter.emitEvent(
        confirmation.runID,
        threadID,
        'confirmation.resolved',
        {
          confirmationID,
          approved: body.approved,
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

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadImageResponseDto> {
    if (!file) {
      throw new BadRequestException('No image file provided');
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid image type. Allowed: JPEG, PNG, GIF, WebP',
      );
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('Image too large. Maximum size: 5MB');
    }

    const imageID = crypto.randomUUID();
    const base64Data = file.buffer.toString('base64');

    await this.imageStorage.store(imageID, base64Data, file.mimetype);

    return {
      imageID,
      mimeType: file.mimetype,
    };
  }
}
