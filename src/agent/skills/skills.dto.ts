export class CreateSkillDto {
  name: string;
  description: string;
  content: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
}

export class UpdateSkillDto {
  description?: string;
  content?: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
}
