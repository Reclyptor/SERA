export class CreateSkillDto {
  name: string;
  description: string;
  content: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
  files?: { path: string; content: string }[];
  origin?: 'seed' | 'agent' | 'user';
}

export class UpdateSkillDto {
  description?: string;
  content?: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
  files?: { path: string; content: string }[];
}
