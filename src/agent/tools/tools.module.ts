import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ToolsRegistry } from './tools.registry';
import { ToolsService } from './tools.service';
import { ToolsBootstrapService } from './tools-bootstrap.service';

@Module({
  imports: [ConfigModule],
  providers: [ToolsRegistry, ToolsService, ToolsBootstrapService],
  exports: [ToolsService, ToolsRegistry],
})
export class ToolsModule {}
