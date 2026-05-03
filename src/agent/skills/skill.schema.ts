import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type SkillDocument = HydratedDocument<Skill>;

@Schema({ _id: false })
export class SkillFile {
  @Prop({ required: true })
  path: string;

  @Prop({ required: true })
  content: string;
}

export const SkillFileSchema = SchemaFactory.createForClass(SkillFile);

@Schema({ timestamps: true })
export class Skill {
  @Prop({ required: true, unique: true, index: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  content: string;

  @Prop()
  license?: string;

  @Prop()
  compatibility?: string;

  @Prop({ type: [String], default: [] })
  allowedTools: string[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, string>;

  @Prop({ type: [SkillFileSchema], default: [] })
  files: SkillFile[];

  @Prop()
  seedHash?: string;

  @Prop({ default: 'active', enum: ['active', 'stale', 'archived'] })
  status: string;

  @Prop()
  lastUsedAt?: Date;

  @Prop({ default: 0 })
  usageCount: number;

  @Prop()
  curatorNotes?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const SkillSchema = SchemaFactory.createForClass(Skill);
