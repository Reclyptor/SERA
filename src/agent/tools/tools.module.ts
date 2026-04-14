import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MemoryModule } from '../memory/memory.module';
import { StateModule } from '../state/state.module';
import { ChatsModule } from '../../chats/chats.module';
import { ToolsRegistry } from './tools.registry';
import { ToolsService } from './tools.service';
import { ToolsBootstrapService } from './tools-bootstrap.service';

@Module({
  imports: [ConfigModule, MemoryModule, StateModule, ChatsModule],
  providers: [ToolsRegistry, ToolsService, ToolsBootstrapService],
  exports: [ToolsService, ToolsRegistry],
})
export class ToolsModule {}
