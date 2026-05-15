import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AttachmentDocument = HydratedDocument<Attachment>;
export type AttachmentKind = 'image' | 'file';

@Schema({ timestamps: true })
export class Attachment {
  @Prop({ required: true, unique: true, index: true })
  attachmentID: string;

  @Prop({ required: true, index: true })
  userID: string;

  @Prop({ index: true })
  chatID?: string;

  @Prop({ index: true })
  messageID?: string;

  @Prop({ required: true, enum: ['image', 'file'] })
  kind: AttachmentKind;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ required: true })
  sha256: string;

  @Prop({ required: true })
  objectKey: string;

  @Prop()
  filename?: string;

  @Prop()
  deletedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);
AttachmentSchema.index({ userID: 1, createdAt: -1 });
AttachmentSchema.index({ userID: 1, chatID: 1 });
