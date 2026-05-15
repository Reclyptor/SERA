import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

@Injectable()
export class ObjectStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.getOrThrow<string>(
      'OBJECT_STORAGE_BUCKET',
    );
    this.prefix = this.configService.get<string>(
      'OBJECT_STORAGE_PREFIX',
      'attachments',
    );

    const accessKeyID = this.configService.get<string>(
      'OBJECT_STORAGE_ACCESS_KEY_ID',
    );
    const secretAccessKey = this.configService.get<string>(
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    );
    const endpoint = this.configService.get<string>('OBJECT_STORAGE_ENDPOINT');

    this.client = new S3Client({
      region: this.configService.get<string>(
        'OBJECT_STORAGE_REGION',
        'us-east-1',
      ),
      endpoint: endpoint || undefined,
      forcePathStyle:
        this.configService.get<string>(
          'OBJECT_STORAGE_FORCE_PATH_STYLE',
          'false',
        ) === 'true',
      credentials:
        accessKeyID && secretAccessKey
          ? {
              accessKeyId: accessKeyID,
              secretAccessKey,
            }
          : undefined,
    });
  }

  buildObjectKey(userID: string, attachmentID: string): string {
    const safeUserID = userID.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${this.prefix}/${safeUserID}/${attachmentID}`;
  }

  async put(params: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        Metadata: params.metadata,
      }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`Object ${key} returned no body`);
    }

    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }
}
