import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PluginConfigRecord,
  PluginConfigDocument,
} from './plugin-config.schema';
import type {
  SeraPlugin,
  PluginContext,
  PluginConfig,
  PluginHookFn,
} from './plugin.interface';
import { ToolsService } from '../tools/tools.service';

@Injectable()
export class PluginLoaderService implements OnModuleInit {
  private readonly logger = new Logger(PluginLoaderService.name);
  private readonly loadedPlugins = new Map<string, SeraPlugin>();
  private readonly knowledgeStore = new Map<string, string>();
  private readonly hooks = new Map<string, PluginHookFn<any>[]>();

  constructor(
    @InjectModel(PluginConfigRecord.name)
    private readonly configModel: Model<PluginConfigDocument>,
    private readonly toolsService: ToolsService,
  ) {}

  async onModuleInit() {
    const configs = await this.configModel.find({ enabled: true }).exec();
    for (const config of configs) {
      await this.loadPlugin(config).catch((err) => {
        this.logger.error(`Failed to load plugin "${config.name}":`, err);
      });
    }
  }

  async loadPlugin(config: PluginConfigDocument): Promise<void> {
    if (this.loadedPlugins.has(config.name)) {
      await this.unloadPlugin(config.name);
    }

    try {
      const mod = await (
        Function('m', 'return import(m)') as (m: string) => Promise<any>
      )(config.packageName);

      const plugin: SeraPlugin = mod.default ?? mod;

      if (!plugin || typeof plugin.onRegister !== 'function') {
        throw new Error(
          `Package "${config.packageName}" does not export a valid SERA plugin (missing onRegister)`,
        );
      }

      const context = this.createContext(config);
      await plugin.onRegister(context);

      this.loadedPlugins.set(config.name, plugin);

      await this.configModel.updateOne(
        { name: config.name },
        { $unset: { loadError: '' } },
      );

      this.logger.log(
        `Loaded plugin "${plugin.name}" v${plugin.version} from ${config.packageName}`,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.configModel.updateOne(
        { name: config.name },
        { $set: { loadError: errorMsg } },
      );
      throw err;
    }
  }

  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.loadedPlugins.get(name);
    if (!plugin) return;

    try {
      await plugin.onUnregister?.();
    } catch (err) {
      this.logger.warn(`Plugin "${name}" onUnregister failed:`, err);
    }

    this.loadedPlugins.delete(name);
    this.logger.log(`Unloaded plugin "${name}"`);
  }

  private createContext(config: PluginConfigDocument): PluginContext {
    const pluginLogger = new Logger(`Plugin:${config.name}`);

    return {
      registerTool: (tool) => {
        this.toolsService.registerTool(tool);
        this.logger.debug(
          `Plugin "${config.name}" registered tool "${tool.name}"`,
        );
      },
      registerKnowledge: (key, content) => {
        this.knowledgeStore.set(`${config.name}:${key}`, content);
      },
      getConfig: <T = unknown>(key: string) => {
        return (config.config?.[key] as T) ?? undefined;
      },
      onPreToolCall: (fn) => this.addHook('onPreToolCall', fn),
      onPostToolCall: (fn) => this.addHook('onPostToolCall', fn),
      onPreLLMCall: (fn) => this.addHook('onPreLLMCall', fn),
      onPostLLMCall: (fn) => this.addHook('onPostLLMCall', fn),
      onSessionStart: (fn) => this.addHook('onSessionStart', fn),
      onSessionEnd: (fn) => this.addHook('onSessionEnd', fn),
      logger: {
        log: (msg) => pluginLogger.log(msg),
        warn: (msg) => pluginLogger.warn(msg),
        error: (msg) => pluginLogger.error(msg),
        debug: (msg) => pluginLogger.debug(msg),
      },
    };
  }

  async runHooks<T>(type: string, args: T): Promise<void> {
    const fns = this.hooks.get(type);
    if (!fns?.length) return;
    for (const fn of fns) {
      try {
        await fn(args);
      } catch (err) {
        this.logger.warn(
          `Plugin hook "${type}" failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private addHook(type: string, fn: PluginHookFn<any>): void {
    const list = this.hooks.get(type) ?? [];
    list.push(fn);
    this.hooks.set(type, list);
  }

  getLoadedPlugins(): Array<{
    name: string;
    version: string;
    description?: string;
  }> {
    return Array.from(this.loadedPlugins.entries()).map(([, plugin]) => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
    }));
  }

  getKnowledge(): Map<string, string> {
    return this.knowledgeStore;
  }

  async addPlugin(config: PluginConfig): Promise<void> {
    await this.configModel.create(config);
    if (config.enabled) {
      const doc = await this.configModel.findOne({ name: config.name }).exec();
      if (doc) await this.loadPlugin(doc);
    }
  }

  async removePlugin(name: string): Promise<void> {
    await this.unloadPlugin(name);
    await this.configModel.deleteOne({ name });
  }

  async listConfigs(): Promise<PluginConfigRecord[]> {
    return this.configModel.find().sort({ name: 1 }).exec();
  }

  async togglePlugin(name: string, enabled: boolean): Promise<void> {
    await this.configModel.updateOne({ name }, { $set: { enabled } });
    if (!enabled) {
      await this.unloadPlugin(name);
    } else {
      const doc = await this.configModel.findOne({ name }).exec();
      if (doc) await this.loadPlugin(doc);
    }
  }
}
