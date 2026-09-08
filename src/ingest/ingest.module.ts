import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClassesModule } from '../classes/classes.module';
import { IngestGateway } from './ingest.gateway';
import { IngestService } from './ingest.service';

@Module({
  imports: [AuthModule, ClassesModule],
  providers: [IngestGateway, IngestService],
})
export class IngestModule {}
