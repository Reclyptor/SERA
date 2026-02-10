import { MessageDto, WorkflowStateEntryDto } from './create-chat.dto';

export class UpdateChatDto {
  messages: MessageDto[];
  workflowState?: WorkflowStateEntryDto[];
}
