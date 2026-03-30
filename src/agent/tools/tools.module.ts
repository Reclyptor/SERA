import { Module } from '@nestjs/common';
import { ToolsRegistry } from './tools.registry';
import { ToolsService } from './tools.service';

@Module({
  providers: [ToolsRegistry, ToolsService],
  exports: [ToolsService, ToolsRegistry],
})
export class ToolsModule {}
