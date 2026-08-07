import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClassesController } from './controllers/classes.controller';
import { ClassesService } from './services/classes.service';
import { ClassSession, ClassSessionSchema } from './schemas/class.schema';
import { VimeoModule } from '../vimeo/vimeo.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClassSession.name, schema: ClassSessionSchema },
    ]),
    VimeoModule,
    ChatModule, // provides ChatService + ChatGateway for the Q&A room
  ],
  controllers: [ClassesController],
  providers: [ClassesService],
  exports: [ClassesService],
})
export class ClassesModule {}
