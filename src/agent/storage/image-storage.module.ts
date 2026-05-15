import { Module } from '@nestjs/common';
import { ImageStorage } from './image.storage';

@Module({
  providers: [ImageStorage],
  exports: [ImageStorage],
})
export class ImageStorageModule {}
