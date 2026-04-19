import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PromptDocument = HydratedDocument<Prompt>;

@Schema({ timestamps: true })
export class Prompt {
  @Prop({ required: true, unique: true })
  slug: string;

  @Prop()
  extends?: string;

  @Prop({ required: true })
  content: string;

  @Prop()
  description?: string;

  @Prop()
  seedHash?: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export const PromptSchema = SchemaFactory.createForClass(Prompt);
