import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatModule } from '../chat/chat.module';
import { ClassSession, ClassSessionSchema } from '../classes/schemas/class.schema';
import { LiveModule } from '../live/live.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TeacherStream, TeacherStreamSchema } from './schemas/teacher-stream.schema';
import { TeacherStreamsController } from './teacher-streams.controller';
import { TeacherStreamsService } from './teacher-streams.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeacherStream.name, schema: TeacherStreamSchema },
      // Read-only here: who has had a class with the teacher (live alerts).
      { name: ClassSession.name, schema: ClassSessionSchema },
    ]),
    LiveModule,
    ChatModule,
    NotificationsModule,
  ],
  controllers: [TeacherStreamsController],
  providers: [TeacherStreamsService],
  exports: [TeacherStreamsService],
})
export class TeacherStreamsModule {}
