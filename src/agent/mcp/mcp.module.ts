import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { McpServer, McpServerSchema } from './mcp-server.schema';
import { McpClientService } from './mcp-client.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: McpServer.name, schema: McpServerSchema },
    ]),
  ],
  providers: [McpClientService],
  exports: [McpClientService],
})
export class McpModule {}
