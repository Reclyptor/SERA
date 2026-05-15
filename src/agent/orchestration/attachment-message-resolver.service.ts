import { Injectable } from '@nestjs/common';
import type { FilePart, ImagePart, ModelMessage, TextPart } from 'ai';
import { AttachmentsService } from '../attachments/attachments.service';
import type { AttachmentKind } from '../attachments/attachment.schema';

interface MessageAttachmentRef {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  filename?: string;
}

type AttachmentModelMessage = ModelMessage & {
  attachments?: MessageAttachmentRef[];
};

@Injectable()
export class AttachmentMessageResolverService {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  async resolve(
    messages: ModelMessage[],
    userID: string,
  ): Promise<ModelMessage[]> {
    return Promise.all(
      messages.map((message) => this.resolveMessage(message, userID)),
    );
  }

  private async resolveMessage(
    message: ModelMessage,
    userID: string,
  ): Promise<ModelMessage> {
    const attachments = (message as AttachmentModelMessage).attachments;
    if (
      message.role !== 'user' ||
      !Array.isArray(attachments) ||
      attachments.length === 0 ||
      typeof message.content !== 'string'
    ) {
      return message;
    }

    const parts: Array<TextPart | ImagePart | FilePart> = [];
    const text = message.content.trim();
    if (text) {
      parts.push({ type: 'text', text });
    }

    for (const attachment of attachments) {
      const { data } = await this.attachmentsService.getContentForUser(
        attachment.id,
        userID,
      );
      if (attachment.kind === 'image') {
        parts.push({
          type: 'image',
          image: data,
          mediaType: attachment.mimeType,
        });
      } else {
        parts.push({
          type: 'file',
          data,
          mediaType: attachment.mimeType,
          filename: attachment.filename,
        });
      }
    }

    return {
      role: 'user',
      content: parts,
      providerOptions: message.providerOptions,
    };
  }
}
