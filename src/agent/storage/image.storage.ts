import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';

export interface StoredImage {
  id: string;
  data: string; // base64
  mimeType: string;
  uploadedAt: string;
}

const IMAGE_TTL = 3600; // 1 hour

@Injectable()
export class ImageStorage {
  private readonly logger = new Logger(ImageStorage.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(id: string): string {
    return `image:${id}`;
  }

  async store(id: string, data: string, mimeType: string): Promise<void> {
    const image: StoredImage = {
      id,
      data,
      mimeType,
      uploadedAt: new Date().toISOString(),
    };
    await this.redis.set(this.key(id), JSON.stringify(image), 'EX', IMAGE_TTL);
    this.logger.log(`Stored image ${id} (${mimeType})`);
  }

  async get(id: string): Promise<StoredImage | undefined> {
    const raw = await this.redis.get(this.key(id));
    if (!raw) return undefined;
    return JSON.parse(raw) as StoredImage;
  }

  async delete(id: string): Promise<void> {
    await this.redis.del(this.key(id));
    this.logger.log(`Deleted image ${id}`);
  }
}
