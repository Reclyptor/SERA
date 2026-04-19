import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SkillDocument = HydratedDocument<Skill>;

@Schema()
export class SkillCompatibility {
  @Prop({ type: [String], default: [] })
  tools: string[];

  @Prop({ type: [String], default: [] })
  env: string[];
}

export const SkillCompatibilitySchema =
  SchemaFactory.createForClass(SkillCompatibility);

@Schema({ timestamps: true })
export class Skill {
  @Prop({ required: true, unique: true, index: true })
  name: string;

  @Prop()
  displayName?: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [String], default: [], index: true })
  allowedTools: string[];

  @Prop({ type: [String], default: [], index: true })
  triggerKeywords: string[];

  @Prop({ type: [String], default: [] })
  agentIDs: string[];

  @Prop({ default: 0 })
  priority: number;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ type: SkillCompatibilitySchema })
  compatibility?: SkillCompatibility;

  @Prop()
  seedHash?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const SkillSchema = SchemaFactory.createForClass(Skill);
