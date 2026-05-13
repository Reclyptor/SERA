import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentRouterService } from './agent-router.service';
import { CreateAgentDto, UpdateAgentDto, CreateBindingDto } from './agents.dto';

@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly routerService: AgentRouterService,
  ) {}

  @Post()
  async create(@Body() dto: CreateAgentDto) {
    return this.agentsService.create(dto);
  }

  @Get()
  async findAll() {
    return this.agentsService.findAll();
  }

  @Get(':agentID')
  async findOne(@Param('agentID') agentID: string) {
    const agent = await this.agentsService.findByID(agentID);
    if (!agent) {
      throw new NotFoundException(`Agent "${agentID}" not found`);
    }
    return agent;
  }

  @Put(':agentID')
  async update(@Param('agentID') agentID: string, @Body() dto: UpdateAgentDto) {
    return this.agentsService.update(agentID, dto);
  }

  @Delete(':agentID')
  async remove(@Param('agentID') agentID: string) {
    const deleted = await this.agentsService.remove(agentID);
    if (!deleted) {
      throw new NotFoundException(`Agent "${agentID}" not found`);
    }
    return { deleted: true };
  }

  // Bindings

  @Post('bindings')
  async createBinding(@Body() dto: CreateBindingDto) {
    return this.routerService.createBinding(dto);
  }

  @Get('bindings/list')
  async listBindings(@Query('agentID') agentID?: string) {
    return this.routerService.listBindings(agentID);
  }

  @Delete('bindings/:bindingID')
  async removeBinding(@Param('bindingID') bindingID: string) {
    const deleted = await this.routerService.removeBinding(bindingID);
    if (!deleted) {
      throw new NotFoundException(`Binding "${bindingID}" not found`);
    }
    return { deleted: true };
  }
}
