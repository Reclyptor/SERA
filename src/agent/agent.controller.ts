import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Sse,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable, map } from 'rxjs';
import type { Request } from 'express';
import { OrchestratorService } from './orchestration/orchestrator.service';
import { AgentEventEmitter } from './streaming/agent-event-emitter';
import { StateService } from './state/state.service';
import { ImageStorage } from './storage/image.storage';
import { ChatsService } from '../chats/chats.service';
import type { UploadImageResponseDto } from './upload-image.dto';
import type { SessionUser } from '../auth/session.strategy';
import type { OrchestratorConfig } from './orchestration/orchestration.interfaces';

interface ChatRequestBody {
  message: string;
  chatId?: string;
  threadId?: string;
  config?: Partial<OrchestratorConfig>;
}

interface ChatResponse {
  runId: string;
  threadId: string;
  chatId: string;
}

@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly eventEmitter: AgentEventEmitter,
    private readonly stateService: StateService,
    private readonly imageStorage: ImageStorage,
    private readonly chatsService: ChatsService,
  ) {}

  @Post('chat')
  async chat(
    @Req() req: Request,
    @Body() body: ChatRequestBody,
  ): Promise<ChatResponse> {
    const user = (req as Request & { user?: SessionUser }).user;
    const userId = user?.sub;
    if (!userId) {
      throw new BadRequestException('Authentication required');
    }

    if (!body.message?.trim()) {
      throw new BadRequestException('Message is required');
    }

    const threadId = body.threadId ?? crypto.randomUUID();
    const runId = crypto.randomUUID();

    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: body.message,
      createdAt: new Date(),
    };

    let chatId: string;
    if (body.chatId) {
      chatId = body.chatId;
      await this.chatsService.appendMessage(chatId, userMessage);
    } else {
      const chat = await this.chatsService.createWithUserMessage(
        userId,
        userMessage,
      );
      chatId = String(chat._id);
    }

    this.orchestrator
      .executeGoal(
        {
          threadId,
          runId,
          userId,
          chatId,
          userMessage: body.message,
          conversationHistory: [],
        },
        body.config,
      )
      .catch((error) => {
        this.logger.error(`Unhandled error in run ${runId}:`, error);
      });

    return { runId, threadId, chatId };
  }

  /**
   * SSE stream for a run. The client connects here after POST /chat.
   */
  @Sse('stream/:runId')
  streamRun(@Param('runId') runId: string): Observable<MessageEvent> {
    return this.eventEmitter.getStream(runId).pipe(
      map(
        (event) =>
          ({
            data: JSON.stringify(event),
          }) as MessageEvent,
      ),
    );
  }

  /**
   * Cancel a running execution.
   */
  @Post('cancel/:runId')
  cancel(@Param('runId') runId: string): { cancelled: boolean } {
    const cancelled = this.orchestrator.cancelRun(runId);
    return { cancelled };
  }

  /**
   * Resolve a pending confirmation.
   */
  @Post('confirm/:threadId/:confirmationId')
  async confirm(
    @Param('threadId') threadId: string,
    @Param('confirmationId') confirmationId: string,
  ): Promise<{ resolved: boolean }> {
    const resolved = await this.stateService.resolvePendingConfirmation(
      threadId,
      confirmationId,
    );
    return { resolved };
  }

  /**
   * Get a state snapshot for a thread.
   */
  @Get('state/:threadId')
  async getState(@Param('threadId') threadId: string) {
    return this.stateService.getSnapshot(threadId);
  }

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('image'))
  uploadImage(
    @UploadedFile() file: Express.Multer.File,
  ): UploadImageResponseDto {
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

    this.imageStorage.store(imageID, base64Data, file.mimetype);

    return {
      imageID,
      mimeType: file.mimetype,
    };
  }
}
