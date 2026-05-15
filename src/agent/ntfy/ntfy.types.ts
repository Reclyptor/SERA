export type NtfyPriority = 'min' | 'low' | 'default' | 'high' | 'max';

export interface NtfyViewAction {
  action: 'view';
  label: string;
  url: string;
  clear?: boolean;
}

export interface NtfyHttpAction {
  action: 'http';
  label: string;
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  clear?: boolean;
}

export type NtfyActionButton = NtfyViewAction | NtfyHttpAction;

export interface NtfyPublishInput {
  title?: string;
  message: string;
  priority?: NtfyPriority;
  tags?: string[];
  click?: string;
  actions?: NtfyActionButton[];
}

export interface NtfyPublishResult {
  id: string;
}

export const NTFY_PRIORITY_MAP: Record<NtfyPriority, number> = {
  min: 1,
  low: 2,
  default: 3,
  high: 4,
  max: 5,
};
