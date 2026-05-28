import type { ModelMessage } from 'ai';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { AttachmentMessageResolverService } from './attachment-message-resolver.service';
import { AttachmentsService } from '../attachments/attachments.service';

describe('AttachmentMessageResolverService', () => {
  const userID = 'user-1';
  const attachmentID = '00000000-0000-4000-8000-000000000001';

  function createResolver(
    getContentForUser: Mock,
  ): AttachmentMessageResolverService {
    return new AttachmentMessageResolverService({
      getContentForUser,
    } as unknown as AttachmentsService);
  }

  it('adds image attachments as AI SDK image parts', async () => {
    const data = Buffer.from('image-bytes');
    const getContentForUser = vi.fn().mockResolvedValue({ data });
    const resolver = createResolver(getContentForUser);
    const messages = [
      {
        role: 'user',
        content: 'Analyze this',
        attachments: [
          {
            id: attachmentID,
            kind: 'image',
            mimeType: 'image/png',
            filename: 'image.png',
          },
        ],
      },
    ] as unknown as ModelMessage[];

    await expect(resolver.resolve(messages, userID)).resolves.toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this' },
          { type: 'image', image: data, mediaType: 'image/png' },
        ],
      },
    ]);
    expect(getContentForUser).toHaveBeenCalledWith(attachmentID, userID);
  });

  it('adds non-image attachments as AI SDK file parts', async () => {
    const data = Buffer.from('file-bytes');
    const getContentForUser = vi.fn().mockResolvedValue({ data });
    const resolver = createResolver(getContentForUser);
    const messages = [
      {
        role: 'user',
        content: '',
        attachments: [
          {
            id: attachmentID,
            kind: 'file',
            mimeType: 'text/plain',
            filename: 'notes.txt',
          },
        ],
      },
    ] as unknown as ModelMessage[];

    await expect(resolver.resolve(messages, userID)).resolves.toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            data,
            mediaType: 'text/plain',
            filename: 'notes.txt',
          },
        ],
      },
    ]);
  });

  it('leaves messages without attachments unchanged', async () => {
    const getContentForUser = vi.fn();
    const resolver = createResolver(getContentForUser);
    const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }];

    await expect(resolver.resolve(messages, userID)).resolves.toEqual(messages);
    expect(getContentForUser).not.toHaveBeenCalled();
  });
});
