import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type PluginConfigDocument = HydratedDocument<PluginConfigRecord>;

@Schema({ timestamps: true })
export class PluginConfigRecord {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true })
  packageName: string;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  config: Record<string, unknown>;

  @Prop()
  version?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  capabilities: Record<string, unknown>;

  @Prop()
  loadError?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const PluginConfigSchema =
  SchemaFactory.createForClass(PluginConfigRecord);
