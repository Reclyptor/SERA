import { Module, Global, Logger } from '@nestjs/common';
import { Connection, Client } from '@temporalio/client';

export const TEMPORAL_CLIENT = Symbol('TEMPORAL_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: TEMPORAL_CLIENT,
      useFactory: async (): Promise<Client> => {
        const logger = new Logger('TemporalModule');
        const address =
          process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

        const connection = await Connection.connect({ address });
        logger.log(`Connected to Temporal server at ${address}`);

        return new Client({ connection });
      },
    },
  ],
  exports: [TEMPORAL_CLIENT],
})
export class TemporalModule {}
