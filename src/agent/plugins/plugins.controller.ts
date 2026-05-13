import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
} from '@nestjs/common';
import { PluginLoaderService } from './plugin-loader.service';

@Controller('plugins')
export class PluginsController {
  constructor(private readonly pluginLoader: PluginLoaderService) {}

  @Get()
  async listPlugins() {
    const [configs, loaded] = await Promise.all([
      this.pluginLoader.listConfigs(),
      this.pluginLoader.getLoadedPlugins(),
    ]);

    return {
      configs,
      loaded,
    };
  }

  @Post()
  async addPlugin(
    @Body()
    body: {
      name: string;
      packageName: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    },
  ) {
    await this.pluginLoader.addPlugin({
      name: body.name,
      packageName: body.packageName,
      enabled: body.enabled ?? true,
      config: body.config,
    });
    return { success: true };
  }

  @Delete(':name')
  async removePlugin(@Param('name') name: string) {
    await this.pluginLoader.removePlugin(name);
    return { success: true };
  }

  @Patch(':name/toggle')
  async togglePlugin(
    @Param('name') name: string,
    @Body() body: { enabled: boolean },
  ) {
    await this.pluginLoader.togglePlugin(name, body.enabled);
    return { success: true };
  }
}
