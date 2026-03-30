import { Injectable, Logger } from '@nestjs/common';

export interface StoredImage {
  id: string;
  data: string; // base64
  mimeType: string;
  uploadedAt: Date;
}

@Injectable()
export class ImageStorage {
  private readonly logger = new Logger(ImageStorage.name);
  private readonly images = new Map<string, StoredImage>();
  private readonly maxAge = 1000 * 60 * 60; // 1 hour

  store(id: string, data: string, mimeType: string): void {
    this.images.set(id, {
      id,
      data,
      mimeType,
      uploadedAt: new Date(),
    });

    this.logger.log(`Stored image ${id} (${mimeType})`);
    this.cleanup();
  }

  get(id: string): StoredImage | undefined {
    return this.images.get(id);
  }

  delete(id: string): void {
    this.images.delete(id);
    this.logger.log(`Deleted image ${id}`);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, image] of this.images.entries()) {
      if (now - image.uploadedAt.getTime() > this.maxAge) {
        this.delete(id);
      }
    }
  }

  getSize(): number {
    return this.images.size;
  }
}
