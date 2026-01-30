import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  Headers,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CopilotKitService } from './copilotkit.service';
import { ImageStorage } from './storage/image.storage';
import type { UploadImageResponseDto } from './dto/upload-image.dto';

interface SingleEndpointParams {
  agentId?: string;
  threadId?: string;
}

interface SingleEndpointRequest {
  method: string;
  params?: SingleEndpointParams;
  body?: unknown;
}

type MethodHandler = (
  params: SingleEndpointParams,
  body: unknown,
  headers: Record<string, string>,
  res: Response,
) => Promise<void> | void;

@Controller('copilotkit')
export class CopilotKitController {
  private readonly methodHandlers: Map<string, MethodHandler>;

  constructor(
    private readonly copilotKitService: CopilotKitService,
    private readonly imageStorage: ImageStorage,
  ) {
    this.methodHandlers = new Map<string, MethodHandler>([
      ['info', this.handleInfo.bind(this)],
      ['agent/run', this.handleAgentRun.bind(this)],
      ['agent/connect', this.handleAgentConnect.bind(this)],
      ['agent/stop', this.handleAgentStop.bind(this)],
    ]);
  }

  @Post()
  async handleSingleEndpoint(
    @Body() request: SingleEndpointRequest,
    @Headers() headers: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const { method, params = {}, body } = request;

    const handler = this.methodHandlers.get(method);
    if (!handler) {
      throw new BadRequestException(`Unknown method: ${method}`);
    }

    await handler(params, body, headers, res);
  }

  private handleInfo(
    _params: SingleEndpointParams,
    _body: unknown,
    _headers: Record<string, string>,
    res: Response,
  ): void {
    res.json(this.copilotKitService.getRuntimeInfo());
  }

  private async handleAgentRun(
    params: SingleEndpointParams,
    body: unknown,
    headers: Record<string, string>,
    res: Response,
  ): Promise<void> {
    if (!params.agentId) {
      throw new BadRequestException('Missing agentId');
    }
    await this.copilotKitService.runAgent(params.agentId, body, headers, res);
  }

  private async handleAgentConnect(
    params: SingleEndpointParams,
    body: unknown,
    _headers: Record<string, string>,
    res: Response,
  ): Promise<void> {
    if (!params.agentId) {
      throw new BadRequestException('Missing agentId');
    }
    await this.copilotKitService.connectAgent(params.agentId, body, res);
  }

  private async handleAgentStop(
    params: SingleEndpointParams,
    _body: unknown,
    _headers: Record<string, string>,
    res: Response,
  ): Promise<void> {
    if (!params.agentId || !params.threadId) {
      throw new BadRequestException('Missing agentId or threadId');
    }
    const result = await this.copilotKitService.stopAgent(
      params.agentId,
      params.threadId,
    );
    res.json(result);
  }

  @Get('info')
  getInfo() {
    return this.copilotKitService.getRuntimeInfo();
  }

  @Post('agent/:agentId/run')
  async runAgent(
    @Param('agentId') agentId: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    await this.copilotKitService.runAgent(agentId, body, headers, res);
  }

  @Post('agent/:agentId/connect')
  async connectAgent(
    @Param('agentId') agentId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    await this.copilotKitService.connectAgent(agentId, body, res);
  }

  @Post('agent/:agentId/stop/:threadId')
  async stopAgent(
    @Param('agentId') agentId: string,
    @Param('threadId') threadId: string,
  ): Promise<{ success: boolean }> {
    return this.copilotKitService.stopAgent(agentId, threadId);
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
      throw new BadRequestException('Invalid image type. Allowed: JPEG, PNG, GIF, WebP');
    }

    // Check size (5MB limit for Claude)
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
