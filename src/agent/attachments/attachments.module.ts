import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Attachment, AttachmentSchema } from './attachment.schema';
import { AttachmentsService } from './attachments.service';
import { ObjectStorageService } from './object-storage.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Attachment.name, schema: AttachmentSchema },
    ]),
  ],
  providers: [AttachmentsService, ObjectStorageService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
