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
import { CreateAgentDto, UpdateAgentDto } from './agents.dto';

class CreateBindingDto {
  agentId: string;
  bindingType: 'channel' | 'user' | 'default';
  bindingValue?: string;
  priority?: number;
}

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

  @Get(':agentId')
  async findOne(@Param('agentId') agentId: string) {
    const agent = await this.agentsService.findById(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent "${agentId}" not found`);
    }
    return agent;
  }

  @Put(':agentId')
  async update(
    @Param('agentId') agentId: string,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.agentsService.update(agentId, dto);
  }

  @Delete(':agentId')
  async remove(@Param('agentId') agentId: string) {
    const deleted = await this.agentsService.remove(agentId);
    if (!deleted) {
      throw new NotFoundException(`Agent "${agentId}" not found`);
    }
    return { deleted: true };
  }

  // Bindings

  @Post('bindings')
  async createBinding(@Body() dto: CreateBindingDto) {
    return this.routerService.createBinding(dto);
  }

  @Get('bindings/list')
  async listBindings(@Query('agentId') agentId?: string) {
    return this.routerService.listBindings(agentId);
  }

  @Delete('bindings/:bindingId')
  async removeBinding(@Param('bindingId') bindingId: string) {
    const deleted = await this.routerService.removeBinding(bindingId);
    if (!deleted) {
      throw new NotFoundException(`Binding "${bindingId}" not found`);
    }
    return { deleted: true };
  }
}
