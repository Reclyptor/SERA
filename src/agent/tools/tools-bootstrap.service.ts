import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ToolsService } from './tools.service';
import { MemoryService } from '../memory/memory.service';
import { StateService } from '../state/state.service';
import { ChatsService } from '../../chats/chats.service';
import { AgentsService } from '../../agents/agents.service';
import { AgentRouterService } from '../../agents/agent-router.service';
import {
  ReadTool,
  WriteTool,
  EditTool,
  ApplyPatchTool,
  ExecTool,
  BashTool,
  ProcessTool,
  CodeExecutionTool,
  WebFetchTool,
  WebSearchTool,
  XSearchTool,
  BrowserTool,
  ImageTool,
  ImageGenerateTool,
  TtsTool,
  MemorySearchTool,
  MemoryGetTool,
  CronTool,
  MessageTool,
  AgentMessageTool,
  SessionsListTool,
  SessionsHistoryTool,
  SessionsSendTool,
  SessionsSpawnTool,
  SessionStatusTool,
  SubagentsTool,
  AgentsListTool,
  TaskPlanTool,
  AgentConfigTool,
  TriggerTool,
} from './implementations';

@Injectable()
export class ToolsBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ToolsBootstrapService.name);

  constructor(
    private readonly toolsService: ToolsService,
    private readonly configService: ConfigService,
    private readonly memoryService: MemoryService,
    private readonly stateService: StateService,
    private readonly chatsService: ChatsService,
    private readonly agentsService: AgentsService,
    private readonly agentRouter: AgentRouterService,
    private readonly moduleRef: ModuleRef,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  onModuleInit() {
    this.registerCoreTools();
  }

  private registerCoreTools() {
    const workspace =
      this.configService.get<string>('WORKSPACE_DIR') || process.cwd();
    const shellEnabled =
      this.configService.get<string>('ENABLE_SHELL_TOOL') === 'true';
    const openaiKey = this.configService.get<string>('OPENAI_API_KEY');

    // File operations
    this.toolsService.registerTool(new ReadTool(workspace));
    this.toolsService.registerTool(new WriteTool(workspace));
    this.toolsService.registerTool(new EditTool(workspace));
    this.toolsService.registerTool(new ApplyPatchTool(workspace));

    // Runtime
    this.toolsService.registerTool(new ExecTool(workspace, shellEnabled));
    this.toolsService.registerTool(new BashTool(workspace, shellEnabled));
    this.toolsService.registerTool(new ProcessTool(workspace, shellEnabled));
    this.toolsService.registerTool(
      new CodeExecutionTool(workspace, shellEnabled),
    );

    // Web & search
    this.toolsService.registerTool(new WebFetchTool());
    this.toolsService.registerTool(
      new WebSearchTool(this.configService.get<string>('BRAVE_SEARCH_API_KEY')),
    );
    this.toolsService.registerTool(
      new XSearchTool(
        this.configService.get<string>('X_API_BEARER_TOKEN'),
      ),
    );
    this.toolsService.registerTool(new BrowserTool());

    // Media
    this.toolsService.registerTool(new ImageTool(openaiKey, workspace));
    this.toolsService.registerTool(new ImageGenerateTool(openaiKey));
    this.toolsService.registerTool(new TtsTool(openaiKey));

    // Memory
    this.toolsService.registerTool(new MemorySearchTool(this.memoryService));
    this.toolsService.registerTool(new MemoryGetTool(this.memoryService));

    // Automation & messaging
    const lazyCronScheduler: import('./implementations/cron.tool').CronSchedulerLike = {
      create: (data) => {
        const { CronSchedulerService } = require('../cron/cron-scheduler.service');
        return this.moduleRef.get(CronSchedulerService, { strict: false }).create(data);
      },
      findAll: (agentId) => {
        const { CronSchedulerService } = require('../cron/cron-scheduler.service');
        return this.moduleRef.get(CronSchedulerService, { strict: false }).findAll(agentId);
      },
      remove: (jobId) => {
        const { CronSchedulerService } = require('../cron/cron-scheduler.service');
        return this.moduleRef.get(CronSchedulerService, { strict: false }).remove(jobId);
      },
      setEnabled: (jobId, enabled) => {
        const { CronSchedulerService } = require('../cron/cron-scheduler.service');
        return this.moduleRef.get(CronSchedulerService, { strict: false }).setEnabled(jobId, enabled);
      },
    };
    this.toolsService.registerTool(new CronTool(lazyCronScheduler));
    this.toolsService.registerTool(new MessageTool(this.chatsService));

    // Shared lazy deps for agent delegation tools
    const lazyOrchestrator: import('./implementations/agent-message.tool').OrchestratorLike = {
      executeGoal: (goal, config) => {
        const { OrchestratorService } = require('../orchestration/orchestrator.service');
        const orchestrator = this.moduleRef.get(OrchestratorService, { strict: false });
        return orchestrator.executeGoal(goal, config);
      },
    };
    const runReader: import('./implementations/agent-message.tool').RunReaderLike = {
      getRunResponse: async (runId: string) => {
        const doc = await this.connection
          .collection('runs')
          .findOne({ runId });
        if (!doc) return null;
        return {
          status: doc.status as string,
          response: doc.response as string | undefined,
        };
      },
    };

    this.toolsService.registerTool(
      new AgentMessageTool(this.agentsService, lazyOrchestrator, runReader),
    );

    // Sessions & agents
    this.toolsService.registerTool(new SessionsListTool(this.connection));
    this.toolsService.registerTool(
      new SessionsHistoryTool(this.chatsService),
    );
    this.toolsService.registerTool(new SessionsSendTool(this.chatsService));
    this.toolsService.registerTool(
      new SessionsSpawnTool(lazyOrchestrator, this.agentRouter, runReader),
    );
    this.toolsService.registerTool(new SessionStatusTool(this.stateService));
    this.toolsService.registerTool(new SubagentsTool(this.connection));
    this.toolsService.registerTool(new AgentsListTool(this.agentsService));

    // Task decomposition (lazily resolved to avoid circular deps)
    const lazyTasksService: import('./implementations/task-plan.tool').TasksServiceLike = {
      createPlan: (data) => {
        const { TasksService } = require('../tasks/tasks.service');
        return this.moduleRef.get(TasksService, { strict: false }).createPlan(data);
      },
      getPlan: (planId) => {
        const { TasksService } = require('../tasks/tasks.service');
        return this.moduleRef.get(TasksService, { strict: false }).getPlan(planId);
      },
      listPlans: (filters) => {
        const { TasksService } = require('../tasks/tasks.service');
        return this.moduleRef.get(TasksService, { strict: false }).listPlans(filters);
      },
      updateTask: (planId, taskId, update) => {
        const { TasksService } = require('../tasks/tasks.service');
        return this.moduleRef.get(TasksService, { strict: false }).updateTask(planId, taskId, update);
      },
      deletePlan: (planId) => {
        const { TasksService } = require('../tasks/tasks.service');
        return this.moduleRef.get(TasksService, { strict: false }).deletePlan(planId);
      },
    };
    this.toolsService.registerTool(new TaskPlanTool(lazyTasksService));

    // Agent self-configuration (lazily resolved)
    const lazyHeartbeat: import('./implementations/agent-config.tool').SelfConfigHeartbeatLike = {
      findByAgent: (agentId) => {
        const { HeartbeatService } = require('../heartbeat/heartbeat.service');
        return this.moduleRef.get(HeartbeatService, { strict: false }).findByAgent(agentId);
      },
      create: (data) => {
        const { HeartbeatService } = require('../heartbeat/heartbeat.service');
        return this.moduleRef.get(HeartbeatService, { strict: false }).create(data);
      },
      update: (agentId, data) => {
        const { HeartbeatService } = require('../heartbeat/heartbeat.service');
        return this.moduleRef.get(HeartbeatService, { strict: false }).update(agentId, data);
      },
    };
    const lazySkills: import('./implementations/agent-config.tool').SelfConfigSkillsLike = {
      create: (dto) => {
        const { SkillsService } = require('../skills/skills.service');
        return this.moduleRef.get(SkillsService, { strict: false }).create(dto);
      },
      findAll: () => {
        const { SkillsService } = require('../skills/skills.service');
        return this.moduleRef.get(SkillsService, { strict: false }).findAll();
      },
      update: (skillId, dto) => {
        const { SkillsService } = require('../skills/skills.service');
        return this.moduleRef.get(SkillsService, { strict: false }).update(skillId, dto);
      },
      remove: (skillId) => {
        const { SkillsService } = require('../skills/skills.service');
        return this.moduleRef.get(SkillsService, { strict: false }).remove(skillId);
      },
    };
    this.toolsService.registerTool(
      new AgentConfigTool(this.agentsService, lazyHeartbeat, lazySkills),
    );

    // Webhook triggers (lazily resolved)
    const lazyTriggers: import('./implementations/trigger.tool').TriggersServiceLike = {
      create: (data) => {
        const { TriggersService } = require('../triggers/triggers.service');
        return this.moduleRef.get(TriggersService, { strict: false }).create(data);
      },
      findAll: (agentId) => {
        const { TriggersService } = require('../triggers/triggers.service');
        return this.moduleRef.get(TriggersService, { strict: false }).findAll(agentId);
      },
      update: (triggerId, data) => {
        const { TriggersService } = require('../triggers/triggers.service');
        return this.moduleRef.get(TriggersService, { strict: false }).update(triggerId, data);
      },
      remove: (triggerId) => {
        const { TriggersService } = require('../triggers/triggers.service');
        return this.moduleRef.get(TriggersService, { strict: false }).remove(triggerId);
      },
    };
    this.toolsService.registerTool(new TriggerTool(lazyTriggers));

    this.logger.log(
      `Registered 31 core tools (shell: ${shellEnabled ? 'enabled' : 'disabled'})`,
    );
  }
}
