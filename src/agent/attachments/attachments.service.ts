import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID, createHash } from 'crypto';
import { Model } from 'mongoose';
import {
  Attachment,
  AttachmentDocument,
  type AttachmentKind,
} from './attachment.schema';
import { ObjectStorageService } from './object-storage.service';

@Injectable()
export class AttachmentsService {
  private readonly maxUploadBytes: number;

  constructor(
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<AttachmentDocument>,
    private readonly objectStorage: ObjectStorageService,
    configService: ConfigService,
  ) {
    this.maxUploadBytes =
      parseInt(
        configService.get<string>(
          'OBJECT_STORAGE_MAX_UPLOAD_BYTES',
          String(25 * 1024 * 1024),
        ),
        10,
      ) || 25 * 1024 * 1024;
  }

  async createFromUpload(
    file: Express.Multer.File,
    userID: string,
  ): Promise<Attachment> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (file.size > this.maxUploadBytes) {
      throw new BadRequestException(
        `File too large. Maximum size: ${this.maxUploadBytes} bytes`,
      );
    }

    const attachmentID = randomUUID();
    const mimeType = file.mimetype || 'application/octet-stream';
    const objectKey = this.objectStorage.buildObjectKey(userID, attachmentID);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const kind: AttachmentKind = mimeType.startsWith('image/')
      ? 'image'
      : 'file';

    await this.objectStorage.put({
      key: objectKey,
      body: file.buffer,
      contentType: mimeType,
      metadata: {
        attachmentID,
        userID,
        sha256,
      },
    });

    return this.attachmentModel.create({
      attachmentID,
      userID,
      kind,
      mimeType,
      size: file.size,
      sha256,
      objectKey,
      filename: file.originalname,
    });
  }

  async findByIDForUser(
    attachmentID: string,
    userID: string,
  ): Promise<AttachmentDocument> {
    const attachment = await this.attachmentModel
      .findOne({ attachmentID, userID, deletedAt: { $exists: false } })
      .exec();
    if (!attachment) {
      throw new NotFoundException(`Attachment ${attachmentID} not found`);
    }
    return attachment;
  }

  async findManyByIDsForUser(
    attachmentIDs: string[],
    userID: string,
  ): Promise<AttachmentDocument[]> {
    if (attachmentIDs.length === 0) return [];

    const uniqueIDs = Array.from(new Set(attachmentIDs));
    const attachments = await this.attachmentModel
      .find({
        attachmentID: { $in: uniqueIDs },
        userID,
        deletedAt: { $exists: false },
      })
      .exec();

    if (attachments.length !== uniqueIDs.length) {
      throw new NotFoundException('One or more attachments were not found');
    }

    const byID = new Map(attachments.map((a) => [a.attachmentID, a]));
    return uniqueIDs.map((id) => byID.get(id)!);
  }

  async bindToMessage(params: {
    attachmentIDs: string[];
    userID: string;
    chatID: string;
    messageID: string;
  }): Promise<void> {
    if (params.attachmentIDs.length === 0) return;

    await this.attachmentModel
      .updateMany(
        {
          attachmentID: { $in: params.attachmentIDs },
          userID: params.userID,
        },
        {
          $set: {
            chatID: params.chatID,
            messageID: params.messageID,
          },
        },
      )
      .exec();
  }

  async getContentForUser(
    attachmentID: string,
    userID: string,
  ): Promise<{ attachment: AttachmentDocument; data: Buffer }> {
    const attachment = await this.findByIDForUser(attachmentID, userID);
    const data = await this.objectStorage.getBuffer(attachment.objectKey);
    return { attachment, data };
  }
}
