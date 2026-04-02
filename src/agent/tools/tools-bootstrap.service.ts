import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ToolsService } from './tools.service';
import {
  HttpClientTool,
  WebSearchTool,
  FileIOTool,
  ShellExecTool,
  DatabaseQueryTool,
  CreatePlanTool,
  UpdateStepTool,
  EvaluateProgressTool,
  type PlanStore,
} from './implementations';
import type { AgentPlan } from '../orchestration/orchestration.interfaces';

@Injectable()
export class ToolsBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ToolsBootstrapService.name);
  private readonly planStore: PlanStore;

  constructor(
    private readonly toolsService: ToolsService,
    private readonly configService: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {
    // In-memory plan store shared across planning tools
    const plans = new Map<string, AgentPlan>();
    this.planStore = {
      get: (runId) => plans.get(runId),
      set: (runId, plan) => plans.set(runId, plan),
    };
  }

  onModuleInit() {
    this.registerCoreTools();
  }

  private registerCoreTools() {
    const workspace =
      this.configService.get<string>('WORKSPACE_DIR') || process.cwd();

    // HTTP & web
    this.toolsService.registerTool(new HttpClientTool());
    this.toolsService.registerTool(
      new WebSearchTool(this.configService.get<string>('BRAVE_SEARCH_API_KEY')),
    );

    // File system
    this.toolsService.registerTool(new FileIOTool(workspace));

    // Shell (disabled by default)
    const shellEnabled =
      this.configService.get<string>('ENABLE_SHELL_TOOL') === 'true';
    this.toolsService.registerTool(new ShellExecTool(workspace, shellEnabled));

    // Database
    this.toolsService.registerTool(new DatabaseQueryTool(this.connection));

    // Planning
    this.toolsService.registerTool(new CreatePlanTool(this.planStore));
    this.toolsService.registerTool(new UpdateStepTool(this.planStore));
    this.toolsService.registerTool(new EvaluateProgressTool(this.planStore));

    this.logger.log(
      `Registered 8 core tools (shell: ${shellEnabled ? 'enabled' : 'disabled'})`,
    );
  }
}
