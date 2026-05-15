import type { Attachment, AttachmentKind } from './attachment.schema';

export interface AttachmentResponseDto {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  filename?: string;
  createdAt: string;
}

export function serializeAttachment(
  attachment: Pick<
    Attachment,
    'attachmentID' | 'kind' | 'mimeType' | 'size' | 'filename' | 'createdAt'
  >,
): AttachmentResponseDto {
  return {
    id: attachment.attachmentID,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    size: attachment.size,
    filename: attachment.filename,
    createdAt: attachment.createdAt.toISOString(),
  };
}
