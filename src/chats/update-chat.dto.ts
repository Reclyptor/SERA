import { MessageDto } from './create-chat.dto';

/**
 * Partial-update DTO for `PATCH /chats/:id`. Each field is independently
 * optional so the picker UIs can flip a single setting without resending
 * the whole conversation. Validation lives in `ChatsService.update`.
 */
export class UpdateChatDto {
  messages?: MessageDto[];
  agentID?: string;
  model?: string;
}
