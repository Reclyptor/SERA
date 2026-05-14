import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Commitment, CommitmentSchema } from './commitment.schema';
import { CommitmentsService } from './commitments.service';
import { CommitmentExtractorService } from './commitment-extractor.service';
import { ModelModule } from '../model/model.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Commitment.name, schema: CommitmentSchema },
    ]),
    ModelModule,
  ],
  providers: [CommitmentsService, CommitmentExtractorService],
  exports: [CommitmentsService, CommitmentExtractorService],
})
export class CommitmentsModule {}
