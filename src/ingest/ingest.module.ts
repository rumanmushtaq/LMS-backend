import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClassesModule } from '../classes/classes.module';
import { TeacherStreamsModule } from '../teacher-streams/teacher-streams.module';
import { IngestGateway } from './ingest.gateway';
import { IngestService } from './ingest.service';

@Module({
  imports: [AuthModule, ClassesModule, TeacherStreamsModule],
  providers: [IngestGateway, IngestService],
})
export class IngestModule {}
