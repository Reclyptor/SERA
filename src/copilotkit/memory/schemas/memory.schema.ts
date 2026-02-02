import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type MemoryDocument = HydratedDocument<Memory>;

@Schema({ timestamps: true })
export class Memory {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [Number], required: true })
  embedding: number[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, unknown>;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ default: 0 })
  accessCount: number;

  @Prop()
  lastAccessedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const MemorySchema = SchemaFactory.createForClass(Memory);

// Index for vector similarity search (requires MongoDB Atlas or compatible)
MemorySchema.index({ userId: 1, createdAt: -1 });
MemorySchema.index({ userId: 1, tags: 1 });
