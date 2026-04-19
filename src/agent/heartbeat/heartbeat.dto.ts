export class CreateHeartbeatDto {
  agentID: string;
  intervalMinutes?: number;
  activeHours?: { start: number; end: number; timezone?: string };
  checklist?: string[];
  maxTokens?: number;
  enabled?: boolean;
}

export class UpdateHeartbeatDto {
  intervalMinutes?: number;
  activeHours?: { start: number; end: number; timezone?: string };
  checklist?: string[];
  maxTokens?: number;
  enabled?: boolean;
}
