import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { ImagePrunerService } from './image-pruner.service';

describe('ImagePrunerService', () => {
  const service = new ImagePrunerService();

  function imgUserMessage(): ModelMessage {
    return {
      role: 'user',
      content: [
        { type: 'text', text: 'analyze' },
        { type: 'image', image: Buffer.from('big-image') },
      ],
    } as unknown as ModelMessage;
  }

  function textUserMessage(text: string): ModelMessage {
    return { role: 'user', content: text };
  }

  function imgAssistantMessage(): ModelMessage {
    return {
      role: 'assistant',
      content: [
        { type: 'text', text: 'here is your image too' },
        { type: 'image', image: Buffer.from('older-image') },
      ],
    } as unknown as ModelMessage;
  }

  it('is a no-op when no message has images', () => {
    const messages = [textUserMessage('hi'), textUserMessage('again')];
    const { messages: result, images } = service.prune(messages);
    expect(result).toBe(messages);
    expect(images).toBe(0);
  });

  it('is a no-op when only the first message has images', () => {
    const messages = [imgUserMessage(), textUserMessage('later')];
    const { messages: result, images } = service.prune(messages);
    expect(result).toBe(messages);
    expect(images).toBe(0);
  });

  it('strips images from messages older than the newest image-bearing user', () => {
    const messages = [
      imgUserMessage(),
      imgAssistantMessage(),
      textUserMessage('still talking'),
      imgUserMessage(),
    ];
    const { messages: result, images } = service.prune(messages);
    expect(images).toBe(2);

    // First user message: image replaced
    const first = result[0].content as Array<{ type: string; text?: string }>;
    expect(first.find((p) => p.type === 'image')).toBeUndefined();
    expect(
      first.find((p) => p.text === '[screenshot removed to save context]'),
    ).toBeTruthy();

    // Assistant message: image replaced
    const assistant = result[1].content as Array<{
      type: string;
      text?: string;
    }>;
    expect(assistant.find((p) => p.type === 'image')).toBeUndefined();

    // Anchor user message (last): image preserved
    const anchor = result[3].content as Array<{ type: string }>;
    expect(anchor.find((p) => p.type === 'image')).toBeTruthy();
  });

  it('replaces image_url and input_image variants too', () => {
    const oldMsg = {
      role: 'user',
      content: [
        { type: 'text', text: 'first' },
        { type: 'image_url', image_url: 'data:...' },
        { type: 'input_image', image_url: 'data:...' },
      ],
    } as unknown as ModelMessage;
    const newMsg = imgUserMessage();
    const { messages, images } = service.prune([oldMsg, newMsg]);
    expect(images).toBe(2);
    const stripped = messages[0].content as Array<{ type: string }>;
    expect(stripped.filter((p) => p.type === 'image_url')).toHaveLength(0);
    expect(stripped.filter((p) => p.type === 'input_image')).toHaveLength(0);
  });
});
