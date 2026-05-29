import { Injectable } from '@nestjs/common';
import type { ModelMessage } from 'ai';

const IMAGE_PLACEHOLDER = '[screenshot removed to save context]';
const IMAGE_PART_TYPES = new Set(['image', 'image_url', 'input_image']);

interface ImagePart {
  type: string;
  [key: string]: unknown;
}

function isImagePart(part: unknown): part is ImagePart {
  if (typeof part !== 'object' || part == null) return false;
  const type = (part as { type?: unknown }).type;
  return typeof type === 'string' && IMAGE_PART_TYPES.has(type);
}

function contentHasImages(content: unknown): boolean {
  return Array.isArray(content) && content.some(isImagePart);
}

@Injectable()
export class ImagePrunerService {
  prune(messages: ModelMessage[]): {
    messages: ModelMessage[];
    images: number;
  } {
    // Anchor on the newest user message that carries image parts. Everything
    // before that anchor gets its images replaced with a text placeholder so
    // multi-MB base64 payloads stop riding every subsequent request.
    let anchor = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user' && contentHasImages(msg.content)) {
        anchor = i;
        break;
      }
    }
    if (anchor <= 0) {
      return { messages, images: 0 };
    }

    let images = 0;
    const result = messages.map((msg, idx) => {
      if (idx >= anchor) return msg;
      if (!Array.isArray(msg.content)) return msg;
      if (!contentHasImages(msg.content)) return msg;

      const newContent = (msg.content as unknown[]).map((part) => {
        if (!isImagePart(part)) return part;
        images += 1;
        return { type: 'text', text: IMAGE_PLACEHOLDER };
      });
      return { ...msg, content: newContent as unknown } as ModelMessage;
    });

    return { messages: result, images };
  }
}
