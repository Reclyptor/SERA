import { Module } from '@nestjs/common';
import { ContentScannerService } from './content-scanner.service';

@Module({
  providers: [ContentScannerService],
  exports: [ContentScannerService],
})
export class SecurityModule {}
