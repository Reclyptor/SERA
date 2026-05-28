import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { createHash } from 'crypto';
import { ToolsService } from './tools.service';
import { ToolsRegistry } from './tools.registry';
import { MemoryService } from '../memory/memory.service';
import { StateService } from '../state/state.service';
import { ChatsService } from '../../chats/chats.service';
import { AgentsService } from '../../agents/agents.service';
import { AgentRouterService } from '../../agents/agent-router.service';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import {
  ReadTool,
  WriteTool,
  EditTool,
  ApplyPatchTool,
  ExecTool,
  ShellTool,
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
  SessionsYieldTool,
  SessionStatusTool,
  SubagentsTool,
  AgentsListTool,
  TaskPlanTool,
  SkillsTool,
  TriggerTool,
  SessionSearchTool,
} from './implementations';

@Injectable()
export class ToolsBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ToolsBootstrapService.name);

  constructor(
    private readonly toolsService: ToolsService,
    private readonly toolsRegistry: ToolsRegistry,
    private readonly configService: ConfigService,
    private readonly memoryService: MemoryService,
    private readonly stateService: StateService,
    private readonly chatsService: ChatsService,
    private readonly agentsService: AgentsService,
    private readonly agentRouter: AgentRouterService,
    private readonly eventEmitter: AgentEventEmitter,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.registerCoreTools();
    this.registerMcpTools();
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

    // Sandbox runner (lazy — resolved only when sandbox is configured on an agent)
    const lazySandboxRunner: import('./implementations/sandbox.types').SandboxRunnerLike =
      {
        exec: (opts) => this.resolveSandboxRunner().exec(opts),
      };
    const approvalRequester = {
      requestApproval: (input: {
        threadID: string;
        runID: string;
        actionName: string;
        args: Record<string, unknown>;
        message: string;
      }) => this.requestToolApproval(input),
    };

    // Runtime
    this.toolsService.registerTool(
      new ExecTool(
        workspace,
        shellEnabled,
        lazySandboxRunner,
        approvalRequester,
      ),
    );
    this.toolsService.registerTool(
      new ShellTool(
        workspace,
        shellEnabled,
        lazySandboxRunner,
        approvalRequester,
      ),
    );
    this.toolsService.registerTool(
      new ProcessTool(
        workspace,
        shellEnabled,
        () => this.resolveOrchestrator(),
        approvalRequester,
      ),
    );
    this.toolsService.registerTool(
      new CodeExecutionTool(
        workspace,
        shellEnabled,
        lazySandboxRunner,
        this.toolsRegistry,
      ),
    );

    // Web & search
    this.toolsService.registerTool(new WebFetchTool());
    this.toolsService.registerTool(
      new WebSearchTool(this.configService.get<string>('BRAVE_SEARCH_API_KEY')),
    );
    this.toolsService.registerTool(
      new XSearchTool(this.configService.get<string>('X_API_BEARER_TOKEN')),
    );
    this.toolsService.registerTool(new BrowserTool());

    // Media
    this.toolsService.registerTool(new ImageTool(openaiKey, workspace));
    this.toolsService.registerTool(new ImageGenerateTool(openaiKey));
    this.toolsService.registerTool(new TtsTool(openaiKey));

    // Memory
    this.toolsService.registerTool(new MemorySearchTool(this.memoryService));
    this.toolsService.registerTool(new MemoryGetTool(this.memoryService));

    // Session search
    this.toolsService.registerTool(new SessionSearchTool(this.chatsService));

    // Automation & messaging
    const lazyCronScheduler: import('./implementations/cron.tool').CronSchedulerLike =
      {
        create: (data) => this.resolveCronScheduler().create(data),
        findAll: (agentID) => this.resolveCronScheduler().findAll(agentID),
        remove: (jobID) => this.resolveCronScheduler().remove(jobID),
        setEnabled: (jobID, enabled) =>
          this.resolveCronScheduler().setEnabled(jobID, enabled),
      };
    this.toolsService.registerTool(new CronTool(lazyCronScheduler));
    this.toolsService.registerTool(new MessageTool(this.chatsService));

    // Shared lazy deps for agent delegation tools
    const lazyOrchestrator: import('./implementations/agent-message.tool').OrchestratorLike =
      {
        executeGoal: (goal, config) =>
          this.resolveOrchestrator().executeGoal(goal, config),
      };
    const runReader: import('./implementations/agent-message.tool').RunReaderLike =
      {
        getRunResponse: async (runID: string) => {
          const run = await this.stateService.getRun(runID);
          if (!run) return null;
          return {
            status: run.status,
            response: run.response,
          };
        },
      };

    this.toolsService.registerTool(
      new AgentMessageTool(this.agentsService, lazyOrchestrator, runReader),
    );

    // Sessions & agents
    const lazyStateService = {
      setCustomState: (threadID: string, key: string, value: unknown) =>
        this.stateService.setCustomState(threadID, key, value),
    };

    this.toolsService.registerTool(new SessionsListTool(this.stateService));
    this.toolsService.registerTool(new SessionsHistoryTool(this.chatsService));
    this.toolsService.registerTool(new SessionsSendTool(this.chatsService));
    this.toolsService.registerTool(
      new SessionsSpawnTool(
        lazyOrchestrator,
        this.agentRouter,
        runReader,
        this.agentsService,
        lazyStateService,
      ),
    );
    this.toolsService.registerTool(new SessionsYieldTool(lazyStateService));
    this.toolsService.registerTool(new SessionStatusTool(this.stateService));
    this.toolsService.registerTool(new SubagentsTool(this.stateService));
    this.toolsService.registerTool(new AgentsListTool(this.agentsService));

    // Task decomposition (lazily resolved to avoid circular deps)
    const lazyTasksService: import('./implementations/task-plan.tool').TasksServiceLike =
      {
        createPlan: (data) => this.resolveTasksService().createPlan(data),
        getPlan: (planID) => this.resolveTasksService().getPlan(planID),
        listPlans: (filters) => this.resolveTasksService().listPlans(filters),
        updateTask: (planID, taskID, update, expectedRevision) =>
          this.resolveTasksService().updateTask(
            planID,
            taskID,
            update,
            expectedRevision,
          ),
        cancelPlan: (planID) => this.resolveTasksService().cancelPlan(planID),
        setState: (planID, key, value, expectedRevision) =>
          this.resolveTasksService().setState(
            planID,
            key,
            value,
            expectedRevision,
          ),
        getState: (planID) => this.resolveTasksService().getState(planID),
        deletePlan: (planID) => this.resolveTasksService().deletePlan(planID),
      };
    this.toolsService.registerTool(new TaskPlanTool(lazyTasksService));

    // Skills (lazily resolved)
    const lazySkills: import('./implementations/skills.tool').SkillsServiceLike =
      {
        findAll: () => this.resolveSkillsService().findAll(),
        findByName: (name) => this.resolveSkillsService().findByName(name),
        create: (dto) => this.resolveSkillsService().create(dto),
        update: (name, dto) => this.resolveSkillsService().update(name, dto),
        remove: (name) => this.resolveSkillsService().remove(name),
        listFiles: (name) => this.resolveSkillsService().listFiles(name),
        findFile: (name, path) =>
          this.resolveSkillsService().findFile(name, path),
        addFile: (name, path, content) =>
          this.resolveSkillsService().addFile(name, path, content),
        updateFile: (name, path, content) =>
          this.resolveSkillsService().updateFile(name, path, content),
        removeFile: (name, path) =>
          this.resolveSkillsService().removeFile(name, path),
      };
    this.toolsService.registerTool(new SkillsTool(lazySkills));

    // Webhook triggers (lazily resolved)
    const lazyTriggers: import('./implementations/trigger.tool').TriggersServiceLike =
      {
        create: (data) => this.resolveTriggersService().create(data),
        findAll: (agentID) => this.resolveTriggersService().findAll(agentID),
        update: (triggerID, data) =>
          this.resolveTriggersService().update(triggerID, data),
        remove: (triggerID) => this.resolveTriggersService().remove(triggerID),
      };
    this.toolsService.registerTool(new TriggerTool(lazyTriggers));

    this.logger.log(
      `Registered 32 core tools (shell: ${shellEnabled ? 'enabled' : 'disabled'})`,
    );
  }

  private resolveSandboxRunner() {
    const {
      SandboxRunnerService,
    } = require('../sandbox/sandbox-runner.service');
    const svc = this.moduleRef.get(SandboxRunnerService, { strict: false });
    if (!svc) throw new Error('SandboxRunnerService not available');
    return svc;
  }

  private async requestToolApproval(input: {
    threadID: string;
    runID: string;
    actionName: string;
    args: Record<string, unknown>;
    message: string;
  }): Promise<{ confirmationID: string; fingerprint: string }> {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          actionName: input.actionName,
          args: input.args,
          runID: input.runID,
        }),
      )
      .digest('hex');

    const pending = await this.stateService.getPendingConfirmations(
      input.threadID,
    );
    const existing = pending.find(
      (confirmation) =>
        confirmation.status === 'pending' &&
        confirmation.actionName === input.actionName &&
        confirmation.args?.fingerprint === fingerprint,
    );
    if (existing) {
      return { confirmationID: existing.id, fingerprint };
    }

    const confirmationID = await this.stateService.addPendingConfirmation(
      input.threadID,
      input.actionName,
      { ...input.args, fingerprint },
      input.message,
      input.runID,
    );

    await this.eventEmitter.emitEvent(
      input.runID,
      input.threadID,
      'approval.requested',
      {
        confirmationID,
        actionName: input.actionName,
        args: input.args,
        fingerprint,
        message: input.message,
      },
    );

    return { confirmationID, fingerprint };
  }

  private resolveCronScheduler() {
    const { CronSchedulerService } = require('../cron/cron-scheduler.service');
    const svc = this.moduleRef.get(CronSchedulerService, { strict: false });
    if (!svc) throw new Error('CronSchedulerService not available');
    return svc;
  }

  private resolveOrchestrator() {
    const {
      OrchestratorService,
    } = require('../orchestration/orchestrator.service');
    const svc = this.moduleRef.get(OrchestratorService, { strict: false });
    if (!svc) throw new Error('OrchestratorService not available');
    return svc;
  }

  private resolveTasksService() {
    const { TasksService } = require('../tasks/tasks.service');
    const svc = this.moduleRef.get(TasksService, { strict: false });
    if (!svc) throw new Error('TasksService not available');
    return svc;
  }

  private resolveSkillsService() {
    const { SkillsService } = require('../skills/skills.service');
    const svc = this.moduleRef.get(SkillsService, { strict: false });
    if (!svc) throw new Error('SkillsService not available');
    return svc;
  }

  private resolveTriggersService() {
    const { TriggersService } = require('../triggers/triggers.service');
    const svc = this.moduleRef.get(TriggersService, { strict: false });
    if (!svc) throw new Error('TriggersService not available');
    return svc;
  }

  private registerMcpTools() {
    // Delay MCP tool registration to allow MCP connections to be established
    setTimeout(() => {
      try {
        const { McpClientService } = require('../mcp/mcp-client.service');
        const mcpClient = this.moduleRef.get(McpClientService, {
          strict: false,
        });
        if (!mcpClient) return;

        const { adaptMcpTool } = require('../mcp/mcp-tool-adapter');
        const tools = mcpClient.getDiscoveredTools();

        for (const toolDef of tools) {
          const adapted = adaptMcpTool(toolDef, mcpClient);
          this.toolsService.registerTool(adapted);
        }

        if (tools.length > 0) {
          this.logger.log(`Registered ${tools.length} MCP tools`);
        }
      } catch (err) {
        this.logger.debug(
          `MCP tool registration skipped: ${err instanceof Error ? err.message : err}`,
        );
      }
    }, 2000);
  }
}
