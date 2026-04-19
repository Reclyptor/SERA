export class SkillCompatibilityDto {
  tools?: string[];
  env?: string[];
}

export class CreateSkillDto {
  name: string;
  displayName?: string;
  description: string;
  content: string;
  allowedTools?: string[];
  triggerKeywords?: string[];
  agentIDs?: string[];
  priority?: number;
  enabled?: boolean;
  compatibility?: SkillCompatibilityDto;
}

export class UpdateSkillDto {
  displayName?: string;
  description?: string;
  content?: string;
  allowedTools?: string[];
  triggerKeywords?: string[];
  agentIDs?: string[];
  priority?: number;
  enabled?: boolean;
  compatibility?: SkillCompatibilityDto;
}
