import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type McpServerDocument = HydratedDocument<McpServer>;

@Schema({ timestamps: true })
export class McpServer {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true, enum: ['stdio', 'sse'] })
  transport: string;

  @Prop()
  command?: string;

  @Prop({ type: [String], default: [] })
  args: string[];

  @Prop()
  url?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  env: Record<string, string>;

  @Prop({ default: true })
  enabled: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const McpServerSchema = SchemaFactory.createForClass(McpServer);
