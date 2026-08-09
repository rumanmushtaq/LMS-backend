import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClassesController } from './controllers/classes.controller';
import { ClassesService } from './services/classes.service';
import { ClassSession, ClassSessionSchema } from './schemas/class.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { VimeoModule } from '../vimeo/vimeo.module';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClassSession.name, schema: ClassSessionSchema },
      // Needed by the cancellation policy: suspend the tutor, alert admins.
      { name: User.name, schema: UserSchema },
    ]),
    VimeoModule,
    ChatModule, // provides ChatService + ChatGateway for the Q&A room
    NotificationsModule, // student cancellation notices + admin alerts
  ],
  controllers: [ClassesController],
  providers: [ClassesService],
  exports: [ClassesService],
})
export class ClassesModule {}
