import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NtfyService } from './ntfy.service';

@Module({
  imports: [ConfigModule],
  providers: [NtfyService],
  exports: [NtfyService],
})
export class NtfyModule {}
