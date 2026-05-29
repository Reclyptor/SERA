import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToolsService } from './tools.service';
import { ToolsRegistry } from './tools.registry';
import { ToolApprovalService } from './tool-approval.service';
import { MemoryService } from '../memory/memory.service';
import { StateService } from '../state/state.service';
import { ChatsService } from '../../chats/chats.service';
import { AgentsService } from '../../agents/agents.service';
import { AgentRouterService } from '../../agents/agent-router.service';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import { SandboxRunnerService } from '../sandbox/sandbox-runner.service';
import { CronSchedulerService } from '../cron/cron-scheduler.service';
import { OrchestratorService } from '../orchestration/orchestrator.service';
import { TasksService } from '../tasks/tasks.service';
import { SkillsService } from '../skills/skills.service';
import { TriggersService } from '../triggers/triggers.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { adaptMcpTool } from '../mcp/mcp-tool-adapter';
import { GitHubHttpClient } from '../../github/github-http-client.service';
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
  SessionsSpawnTool,
  SessionsYieldTool,
  SessionStatusTool,
  SubagentsTool,
  AgentsListTool,
  AgentManagementTool,
  TaskPlanTool,
  SkillsTool,
  TriggerTool,
  SessionSearchTool,
  ClusterGitTool,
  KubectlTool,
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
    private readonly approvalService: ToolApprovalService,
    private readonly sandboxRunner: SandboxRunnerService,
    private readonly tasksService: TasksService,
    private readonly triggersService: TriggersService,
    private readonly mcpClient: McpClientService,
    private readonly gitHubHttpClient: GitHubHttpClient,
    // The remaining three create a module-import cycle with ToolsModule
    // (Orchestration → Tools; Skills → Tools direct; Cron → Orchestration
    // → Tools). `forwardRef` defers resolution so NestJS can complete the
    // ring at runtime.
    @Inject(forwardRef(() => OrchestratorService))
    private readonly orchestrator: OrchestratorService,
    @Inject(forwardRef(() => SkillsService))
    private readonly skillsService: SkillsService,
    @Inject(forwardRef(() => CronSchedulerService))
    private readonly cronScheduler: CronSchedulerService,
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

    // Runtime tools (shell/exec/process gated by ENABLE_SHELL_TOOL).
    // SandboxRunnerService is injected directly; the orchestrator and
    // approval service are injected too. No more lazy-shim resolvers.
    this.toolsService.registerTool(
      new ExecTool(
        workspace,
        shellEnabled,
        this.sandboxRunner,
        this.approvalService,
      ),
    );
    this.toolsService.registerTool(
      new ShellTool(
        workspace,
        shellEnabled,
        this.sandboxRunner,
        this.approvalService,
      ),
    );
    this.toolsService.registerTool(
      new ProcessTool(
        workspace,
        shellEnabled,
        () => this.orchestrator,
        this.approvalService,
      ),
    );
    this.toolsService.registerTool(
      new CodeExecutionTool(
        workspace,
        shellEnabled,
        this.sandboxRunner,
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
    this.toolsService.registerTool(new CronTool(this.cronScheduler));
    this.toolsService.registerTool(new MessageTool(this.chatsService));

    // Inter-agent delegation. The runReader adapts StateService's full
    // run document down to the minimal `{ status, response }` slice the
    // tools consume — keeping the shape narrow makes future reuse and
    // testing easier than passing the full StateService.
    const runReader = {
      getRunResponse: async (runID: string) => {
        const run = await this.stateService.getRun(runID);
        if (!run) return null;
        return { status: run.status, response: run.response };
      },
    };

    this.toolsService.registerTool(
      new AgentMessageTool(this.agentsService, this.orchestrator, runReader),
    );

    // Sessions & agents
    this.toolsService.registerTool(new SessionsListTool(this.stateService));
    this.toolsService.registerTool(new SessionsHistoryTool(this.chatsService));
    this.toolsService.registerTool(
      new SessionsSpawnTool(
        this.orchestrator,
        this.agentRouter,
        runReader,
        this.agentsService,
        this.stateService,
      ),
    );
    this.toolsService.registerTool(new SessionsYieldTool(this.stateService));
    this.toolsService.registerTool(new SessionStatusTool(this.stateService));
    this.toolsService.registerTool(new SubagentsTool(this.stateService));
    this.toolsService.registerTool(new AgentsListTool(this.agentsService));
    this.toolsService.registerTool(
      new AgentManagementTool(this.agentsService, this.approvalService),
    );

    // Task decomposition
    this.toolsService.registerTool(new TaskPlanTool(this.tasksService));

    // Skills
    this.toolsService.registerTool(new SkillsTool(this.skillsService));

    // Webhook triggers
    this.toolsService.registerTool(new TriggerTool(this.triggersService));

    // Cluster GitOps (FluxCD-watched repo)
    const clusterRepo = this.configService.get<string>('CLUSTER_REPO') ?? null;
    const clusterBranch =
      this.configService.get<string>('CLUSTER_BRANCH') ?? 'master';
    this.toolsService.registerTool(
      new ClusterGitTool(
        this.gitHubHttpClient,
        clusterRepo,
        clusterBranch,
        this.approvalService,
      ),
    );

    // Kubernetes direct access
    const kubeconfig = this.configService.get<string>('KUBECONFIG') ?? null;
    const kubeContext = this.configService.get<string>('KUBE_CONTEXT') ?? null;
    this.toolsService.registerTool(
      new KubectlTool(kubeconfig, kubeContext, this.approvalService),
    );

    this.logger.log(
      `Registered 33 core tools (shell: ${shellEnabled ? 'enabled' : 'disabled'}, cluster_git: ${clusterRepo ? 'configured' : 'unconfigured'})`,
    );
  }

  private registerMcpTools() {
    // Delay MCP tool registration so the McpClientService's onModuleInit
    // has time to complete connections + tool discovery against any
    // configured MCP servers.
    setTimeout(() => {
      try {
        const tools = this.mcpClient.getDiscoveredTools();
        for (const toolDef of tools) {
          const adapted = adaptMcpTool(toolDef, this.mcpClient);
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
