import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ThreadDocument = HydratedDocument<Thread>;

@Schema()
export class ToolCall {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  args: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  result?: unknown;

  @Prop({
    required: true,
    enum: ['pending', 'executing', 'completed', 'failed'],
    default: 'pending',
  })
  status: string;

  @Prop({ default: Date.now })
  timestamp: Date;
}

export const ToolCallSchema = SchemaFactory.createForClass(ToolCall);

@Schema({ timestamps: true })
export class Thread {
  @Prop({ required: true, unique: true, index: true })
  threadID: string;

  @Prop({ type: [ToolCallSchema], default: [] })
  toolCalls: ToolCall[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export const ThreadSchema = SchemaFactory.createForClass(Thread);
