export class SkillRequirementsDto {
  tools?: string[];
  env?: string[];
}

export class CreateSkillDto {
  skillID: string;
  name: string;
  description: string;
  content: string;
  triggerTools?: string[];
  triggerKeywords?: string[];
  agentIDs?: string[];
  priority?: number;
  enabled?: boolean;
  requirements?: SkillRequirementsDto;
}

export class UpdateSkillDto {
  name?: string;
  description?: string;
  content?: string;
  triggerTools?: string[];
  triggerKeywords?: string[];
  agentIDs?: string[];
  priority?: number;
  enabled?: boolean;
  requirements?: SkillRequirementsDto;
}
