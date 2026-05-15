import { Injectable, Logger } from '@nestjs/common';
import type { ImagePart, ModelMessage, TextPart, UserContent } from 'ai';
import { ImageStorage, type StoredImage } from '../storage/image.storage';

const IMAGE_MARKER_PATTERN = /\[IMG:([a-f0-9-]+)\]/g;

@Injectable()
export class ImageMessageResolverService {
  private readonly logger = new Logger(ImageMessageResolverService.name);

  constructor(private readonly imageStorage: ImageStorage) {}

  async resolve(messages: ModelMessage[]): Promise<ModelMessage[]> {
    const cache = new Map<string, StoredImage | undefined>();

    return Promise.all(
      messages.map((message) => this.resolveMessage(message, cache)),
    );
  }

  private async resolveMessage(
    message: ModelMessage,
    cache: Map<string, StoredImage | undefined>,
  ): Promise<ModelMessage> {
    if (
      message.role !== 'user' ||
      typeof message.content !== 'string' ||
      !message.content.includes('[IMG:')
    ) {
      return message;
    }

    const content = await this.resolveContent(message.content, cache);
    return { ...message, content };
  }

  private async resolveContent(
    content: string,
    cache: Map<string, StoredImage | undefined>,
  ): Promise<UserContent> {
    const parts: Array<TextPart | ImagePart> = [];
    let cursor = 0;
    let foundMarker = false;

    for (const match of content.matchAll(IMAGE_MARKER_PATTERN)) {
      foundMarker = true;
      const marker = match[0];
      const imageID = match[1];
      const index = match.index ?? 0;

      this.addTextPart(parts, content.slice(cursor, index));

      const image = await this.getImage(imageID, cache);
      if (image) {
        parts.push({
          type: 'image',
          image: image.data,
          mediaType: image.mimeType,
        });
      } else {
        this.logger.warn(`Image marker ${imageID} could not be resolved`);
        parts.push({
          type: 'text',
          text: `[Image unavailable: ${imageID}]`,
        });
      }

      cursor = index + marker.length;
    }

    if (!foundMarker) return content;

    this.addTextPart(parts, content.slice(cursor));
    return parts.length > 0 ? parts : content;
  }

  private async getImage(
    imageID: string,
    cache: Map<string, StoredImage | undefined>,
  ): Promise<StoredImage | undefined> {
    if (!cache.has(imageID)) {
      cache.set(imageID, await this.imageStorage.get(imageID));
    }
    return cache.get(imageID);
  }

  private addTextPart(parts: Array<TextPart | ImagePart>, text: string): void {
    const trimmed = text.trim();
    if (trimmed) {
      parts.push({ type: 'text', text: trimmed });
    }
  }
}
