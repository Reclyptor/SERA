import type { ModelMessage } from 'ai';
import { ImageMessageResolverService } from './image-message-resolver.service';
import { ImageStorage } from '../storage/image.storage';

describe('ImageMessageResolverService', () => {
  const imageID = '00000000-0000-4000-8000-000000000001';

  function createResolver(get: jest.Mock): ImageMessageResolverService {
    return new ImageMessageResolverService({
      get,
    } as unknown as ImageStorage);
  }

  it('replaces user image markers with model image parts', async () => {
    const get = jest.fn().mockResolvedValue({
      id: imageID,
      data: 'base64-data',
      mimeType: 'image/png',
      uploadedAt: '2026-05-14T00:00:00.000Z',
    });
    const resolver = createResolver(get);
    const messages: ModelMessage[] = [
      { role: 'user', content: `Analyze [IMG:${imageID}] please` },
    ];

    await expect(resolver.resolve(messages)).resolves.toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze' },
          { type: 'image', image: 'base64-data', mediaType: 'image/png' },
          { type: 'text', text: 'please' },
        ],
      },
    ]);
    expect(get).toHaveBeenCalledWith(imageID);
  });

  it('leaves non-user messages and already structured content unchanged', async () => {
    const get = jest.fn();
    const resolver = createResolver(get);
    const structured: ModelMessage = {
      role: 'user',
      content: [{ type: 'text', text: `[IMG:${imageID}]` }],
    };
    const messages: ModelMessage[] = [
      { role: 'assistant', content: `[IMG:${imageID}]` },
      structured,
    ];

    const resolved = await resolver.resolve(messages);

    expect(resolved).toEqual(messages);
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps missing image markers visible to the model as unavailable text', async () => {
    const get = jest.fn().mockResolvedValue(undefined);
    const resolver = createResolver(get);

    await expect(
      resolver.resolve([{ role: 'user', content: `[IMG:${imageID}]` }]),
    ).resolves.toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: `[Image unavailable: ${imageID}]` }],
      },
    ]);
  });
});
