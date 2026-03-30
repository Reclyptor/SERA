import {
  Controller,
  Post,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImageStorage } from './storage/image.storage';
import type { UploadImageResponseDto } from './upload-image.dto';

@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly imageStorage: ImageStorage,
  ) {}

  // Chat, streaming, and confirmation endpoints will be added
  // in Phase 3 (Orchestration) and Phase 4 (Streaming).

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
}
