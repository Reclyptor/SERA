import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ModelCatalogService } from './model-catalog.service';
import { CreateModelDto, UpdateModelDto } from './model-catalog.dto';

@Controller('models')
export class ModelsController {
  constructor(private readonly catalog: ModelCatalogService) {}

  @Post()
  async create(@Body() dto: CreateModelDto) {
    this.assertSpecMatchesParts(dto);
    return this.catalog.create(dto);
  }

  @Get()
  async findAll(@Query('enabled') enabled?: string) {
    if (enabled === 'true') {
      return this.catalog.findEnabled();
    }
    return this.catalog.findAll();
  }

  @Get(':provider/:modelID')
  async findOne(
    @Param('provider') provider: string,
    @Param('modelID') modelID: string,
  ) {
    const spec = `${provider}/${modelID}`;
    const entry = await this.catalog.findBySpec(spec);
    if (!entry) {
      throw new NotFoundException(`Model "${spec}" not found`);
    }
    return entry;
  }

  @Patch(':provider/:modelID')
  async update(
    @Param('provider') provider: string,
    @Param('modelID') modelID: string,
    @Body() dto: UpdateModelDto,
  ) {
    return this.catalog.update(`${provider}/${modelID}`, dto);
  }

  @Delete(':provider/:modelID')
  async remove(
    @Param('provider') provider: string,
    @Param('modelID') modelID: string,
  ) {
    const spec = `${provider}/${modelID}`;
    const deleted = await this.catalog.remove(spec);
    if (!deleted) {
      throw new NotFoundException(`Model "${spec}" not found`);
    }
    return { deleted: true };
  }

  private assertSpecMatchesParts(dto: CreateModelDto): void {
    const expected = `${dto.provider}/${dto.modelID}`;
    if (dto.spec !== expected) {
      throw new BadRequestException(
        `spec "${dto.spec}" does not match "${expected}". Use the canonical "provider/modelID" form.`,
      );
    }
  }
}
