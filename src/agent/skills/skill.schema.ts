import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SkillDocument = HydratedDocument<Skill>;

@Schema()
export class SkillRequirements {
  @Prop({ type: [String], default: [] })
  tools: string[];

  @Prop({ type: [String], default: [] })
  env: string[];
}

export const SkillRequirementsSchema =
  SchemaFactory.createForClass(SkillRequirements);

@Schema({ timestamps: true })
export class Skill {
  @Prop({ required: true, unique: true, index: true })
  skillId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [String], default: [], index: true })
  triggerTools: string[];

  @Prop({ type: [String], default: [], index: true })
  triggerKeywords: string[];

  @Prop({ type: [String], default: [] })
  agentIds: string[];

  @Prop({ default: 0 })
  priority: number;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ type: SkillRequirementsSchema })
  requirements?: SkillRequirements;

  createdAt: Date;
  updatedAt: Date;
}

export const SkillSchema = SchemaFactory.createForClass(Skill);
