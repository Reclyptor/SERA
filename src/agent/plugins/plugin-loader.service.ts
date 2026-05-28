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
  PluginCapabilities,
} from './plugin.interface';

type PluginPermission = NonNullable<PluginCapabilities['permissions']>[number];
import { z } from 'zod';
import { ToolsService } from '../tools/tools.service';
import { ToolApprovalService } from '../tools/tool-approval.service';
import type { Tool } from '../tools/tool.interface';

@Injectable()
export class PluginLoaderService implements OnModuleInit {
  private readonly logger = new Logger(PluginLoaderService.name);
  private readonly loadedPlugins = new Map<string, SeraPlugin>();
  private readonly hooks = new Map<string, PluginHookFn<any>[]>();

  constructor(
    @InjectModel(PluginConfigRecord.name)
    private readonly configModel: Model<PluginConfigDocument>,
    private readonly toolsService: ToolsService,
    private readonly approvalService: ToolApprovalService,
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
      // Plugin packages are installed at runtime as arbitrary npm
      // packages — the Function constructor hides the import from
      // TypeScript's static module resolver so the project compiles
      // without those packages present at build time.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const loader = new Function('m', 'return import(m)') as (
        m: string,
      ) => Promise<{ default?: SeraPlugin } & Partial<SeraPlugin>>;

      const mod = await loader(config.packageName);
      const plugin: SeraPlugin = mod.default ?? (mod as SeraPlugin);

      if (typeof plugin?.onRegister !== 'function') {
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
    const caps = (config.capabilities ?? {}) as PluginCapabilities;
    const declared = caps.permissions;

    // No declared permissions = grant all (backward-compat with plugins
    // authored before the capability system existed). Once a plugin
    // declares ANY permissions, the array is treated as a strict
    // allowlist per SPEC §29.7.
    const hasPermission = (perm: PluginPermission): boolean => {
      if (!declared) return true;
      return declared.includes(perm);
    };

    const denyAccess = (perm: PluginPermission, what: string): void => {
      pluginLogger.warn(
        `Denied: ${what} requires "${perm}" in capabilities.permissions`,
      );
    };

    return {
      registerTool: (tool) => {
        if (!hasPermission('tools.register')) {
          denyAccess('tools.register', `tool registration "${tool.name}"`);
          return;
        }
        const finalTool = caps.requiresApproval
          ? this.wrapWithApprovalGate(tool, config.name)
          : tool;
        this.toolsService.registerTool(finalTool);
        this.logger.debug(
          `Plugin "${config.name}" registered tool "${tool.name}"${
            caps.requiresApproval ? ' (approval-gated)' : ''
          }`,
        );
      },
      getConfig: <T = unknown>(key: string) => {
        return (config.config?.[key] as T) ?? undefined;
      },
      onPreToolCall: (fn) => {
        if (!hasPermission('hooks.tools')) {
          denyAccess('hooks.tools', 'onPreToolCall hook');
          return;
        }
        this.addHook('onPreToolCall', fn);
      },
      onPostToolCall: (fn) => {
        if (!hasPermission('hooks.tools')) {
          denyAccess('hooks.tools', 'onPostToolCall hook');
          return;
        }
        this.addHook('onPostToolCall', fn);
      },
      onPreLLMCall: (fn) => {
        if (!hasPermission('hooks.llm')) {
          denyAccess('hooks.llm', 'onPreLLMCall hook');
          return;
        }
        this.addHook('onPreLLMCall', fn);
      },
      onPostLLMCall: (fn) => {
        if (!hasPermission('hooks.llm')) {
          denyAccess('hooks.llm', 'onPostLLMCall hook');
          return;
        }
        this.addHook('onPostLLMCall', fn);
      },
      // Session-lifecycle hooks are not gated — they carry no inputs
      // that affect tool/LLM behavior; they only signal run boundaries.
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

  /**
   * Wraps a plugin-registered tool so every invocation routes through
   * the shared approval gate. The wrapper delegates to
   * `ToolApprovalService.requestApproval`, which discriminates between
   * a fresh prompt (pending), a previously-granted approval (approved
   * → fall through to the original execute), and an explicit denial
   * (rejected → surface to the agent as an error). This is the
   * runtime enforcement layer for `PluginCapabilities.requiresApproval`
   * declared in SPEC §29.7.
   */
  private wrapWithApprovalGate<T extends z.ZodType>(
    tool: Tool<T>,
    pluginName: string,
  ): Tool<T> {
    const approval = this.approvalService;
    const wrapped: Tool<T> = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      parallelSafe: tool.parallelSafe,
      execute: async (args, context) => {
        const verdict = await approval.requestApproval({
          threadID: context.threadID,
          runID: context.runID,
          actionName: tool.name,
          args: args ?? {},
          message: `Plugin "${pluginName}" requests approval to call tool "${tool.name}"`,
        });

        if (verdict.status === 'rejected') {
          return {
            success: false,
            error: `Tool "${tool.name}" rejected by operator${
              verdict.feedback ? `: ${verdict.feedback}` : ''
            }`,
          };
        }
        if (verdict.status === 'pending') {
          return {
            success: false,
            result: {
              status: 'approval_required',
              confirmationID: verdict.confirmationID,
              fingerprint: verdict.fingerprint,
            },
            error: `Tool "${tool.name}" requires approval (${verdict.confirmationID})`,
          };
        }
        return tool.execute(args, context);
      },
    };
    if (tool.getResources) {
      // Forward via property access so `this` stays bound to the
      // original tool instance without extracting the method reference
      // (which trips ESLint's unbound-method rule).
      wrapped.getResources = (args, context) =>
        tool.getResources!(args, context);
    }
    return wrapped;
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
    capabilities?: SeraPlugin['capabilities'];
  }> {
    return Array.from(this.loadedPlugins.entries()).map(([, plugin]) => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      capabilities: plugin.capabilities,
    }));
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
