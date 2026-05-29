import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ModelCatalogEntry,
  ModelCatalogEntrySchema,
} from './model-catalog.schema';
import { ModelCatalogService } from './model-catalog.service';
import { ModelCatalogBootstrapService } from './model-catalog-bootstrap.service';
import { ModelsController } from './models.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ModelCatalogEntry.name, schema: ModelCatalogEntrySchema },
    ]),
  ],
  controllers: [ModelsController],
  providers: [ModelCatalogService, ModelCatalogBootstrapService],
  exports: [ModelCatalogService],
})
export class ModelsModule {}
