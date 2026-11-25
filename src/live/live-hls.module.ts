import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClassesModule } from '../classes/classes.module';
import { TeacherStreamsModule } from '../teacher-streams/teacher-streams.module';
import { LiveHlsController } from './live-hls.controller';
import { LiveHlsService } from './live-hls.service';

@Module({
  imports: [AuthModule, ClassesModule, TeacherStreamsModule],
  controllers: [LiveHlsController],
  providers: [LiveHlsService],
})
export class LiveHlsModule {}
