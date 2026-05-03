import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PluginConfigRecord, PluginConfigSchema } from './plugin-config.schema';
import { PluginLoaderService } from './plugin-loader.service';
import { PluginsController } from './plugins.controller';
import { ToolsModule } from '../tools/tools.module';

@Module({
  imports: [
    ToolsModule,
    MongooseModule.forFeature([
      { name: PluginConfigRecord.name, schema: PluginConfigSchema },
    ]),
  ],
  providers: [PluginLoaderService],
  controllers: [PluginsController],
  exports: [PluginLoaderService],
})
export class PluginsModule {}
