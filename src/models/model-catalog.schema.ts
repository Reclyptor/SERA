import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ModelCatalogEntryDocument = HydratedDocument<ModelCatalogEntry>;

@Schema({ timestamps: true, collection: 'models' })
export class ModelCatalogEntry {
  // Canonical identifier: 'provider/modelID'. Used as the join key with
  // AgentConfig.modelOptions.preferredModel, Chat.model, and request body
  // fields. Treat as the natural primary key.
  @Prop({ required: true, unique: true, index: true })
  spec: string;

  @Prop({ required: true, index: true })
  provider: string;

  @Prop({ required: true })
  modelID: string;

  @Prop({ required: true })
  displayName: string;

  @Prop({ default: true })
  enabled: boolean;

  @Prop()
  contextWindow?: number;

  // Pricing stored as cents per million tokens. The runtime cost calculator
  // divides by 1_000_000 when applying to actual token counts. See SPEC §22.
  @Prop()
  inputCostCentsPerMTok?: number;

  @Prop()
  outputCostCentsPerMTok?: number;

  @Prop()
  cacheReadCostCentsPerMTok?: number;

  @Prop()
  cacheWriteCostCentsPerMTok?: number;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export const ModelCatalogEntrySchema =
  SchemaFactory.createForClass(ModelCatalogEntry);
