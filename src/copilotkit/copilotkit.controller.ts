import {
  Controller,
  Post,
  Res,
  Req,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response, Request } from 'express';
import { CopilotKitService } from './copilotkit.service';
import { ImageStorage } from './storage/image.storage';
import { MemoryService } from './memory/memory.service';
import { PromptsService } from '../prompts/prompts.service';
import type { UploadImageResponseDto } from './upload-image.dto';
import type { SessionUser } from '../auth/session.strategy';

@Controller('copilotkit')
export class CopilotKitController {
  private readonly logger = new Logger(CopilotKitController.name);

  constructor(
    private readonly copilotKitService: CopilotKitService,
    private readonly imageStorage: ImageStorage,
    private readonly memoryService: MemoryService,
    private readonly promptsService: PromptsService,
  ) {}

  /**
   * Single endpoint that delegates to the CopilotKit runtime.
   * The runtime handles AG-UI routing, SSE, tool calls, etc.
   *
   * Controller responsibilities:
   *  1. Inject userId into forwardedProps (for middleware access)
   *  2. Inject memory context into the system/instructions message
   */
  @Post()
  async handleCopilotKit(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user?: SessionUser }).user;
    const userId = user?.sub;

    const body = req.body?.body ?? req.body;
    if (body && typeof body === 'object') {
      if (userId) {
        // Inject userId into forwardedProps so runtime middleware can access it
        body.forwardedProps = { ...body.forwardedProps, userId };
      }

      // Inject system prompt and memory context into messages
      await this.injectSystemPrompt(body);
      if (userId) {
        await this.injectMemoryContext(body, userId);
      }
    }

    await this.copilotKitService.handleRequest(req, res);
  }

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadImageResponseDto> {
    if (!file) {
      throw new BadRequestException('No image file provided');
    }

    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ];
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

  /**
   * Inject the system prompt from MongoDB/Redis as the first system message.
   * If a system message already exists, prepend the prompt to it.
   */
  private async injectSystemPrompt(
    body: Record<string, unknown>,
  ): Promise<void> {
    try {
      const systemPrompt = await this.promptsService.get('system');
      if (!systemPrompt) return;

      const messages = body.messages as
        | Array<{ role?: string; content?: string }>
        | undefined;
      if (!Array.isArray(messages)) return;

      const sysMsg = messages.find(
        (m) => m.role === 'system' || m.role === 'developer',
      );
      if (sysMsg && typeof sysMsg.content === 'string') {
        sysMsg.content = `${systemPrompt}\n\n${sysMsg.content}`;
      } else {
        messages.unshift({ role: 'system', content: systemPrompt });
      }
    } catch {
      // Never fail the request because of prompt retrieval errors
    }
  }

  /**
   * Find the latest user message and prepend relevant memories
   * into the system/instructions message so the LLM has context.
   */
  private async injectMemoryContext(
    body: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    try {
      const messages = body.messages as
        | Array<{ role?: string; content?: string }>
        | undefined;
      if (!Array.isArray(messages)) return;

      const latestUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === 'user');
      const userContent =
        typeof latestUserMsg?.content === 'string'
          ? latestUserMsg.content
          : '';
      if (!userContent) return;

      const memoryContext = await this.memoryService.getContextForQuery(
        userId,
        userContent,
      );
      if (!memoryContext) return;

      // The first message is the system/instructions prompt
      const sysMsg = messages.find(
        (m) => m.role === 'system' || m.role === 'developer',
      );
      if (sysMsg && typeof sysMsg.content === 'string') {
        sysMsg.content = `${sysMsg.content}\n\n${memoryContext}`;
        this.logger.debug(`Injected memory context for user ${userId}`);
      }
    } catch {
      // Never fail the request because of memory retrieval errors
    }
  }
}
