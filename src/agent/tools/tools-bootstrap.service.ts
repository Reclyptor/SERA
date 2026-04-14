import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ToolsService } from './tools.service';
import { MemoryService } from '../memory/memory.service';
import { StateService } from '../state/state.service';
import { ChatsService } from '../../chats/chats.service';
import { AgentsService } from '../../agents/agents.service';
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
  SessionsListTool,
  SessionsHistoryTool,
  SessionsSendTool,
  SessionsSpawnTool,
  SessionStatusTool,
  SubagentsTool,
  AgentsListTool,
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
    this.toolsService.registerTool(new CronTool());
    this.toolsService.registerTool(new MessageTool(this.chatsService));

    // Sessions & agents
    this.toolsService.registerTool(new SessionsListTool(this.connection));
    this.toolsService.registerTool(
      new SessionsHistoryTool(this.chatsService),
    );
    this.toolsService.registerTool(new SessionsSendTool(this.chatsService));
    this.toolsService.registerTool(new SessionsSpawnTool(this.stateService));
    this.toolsService.registerTool(new SessionStatusTool(this.stateService));
    this.toolsService.registerTool(new SubagentsTool(this.connection));
    this.toolsService.registerTool(new AgentsListTool(this.agentsService));

    this.logger.log(
      `Registered 26 core tools (shell: ${shellEnabled ? 'enabled' : 'disabled'})`,
    );
  }
}
