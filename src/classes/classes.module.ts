import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClassesController } from './controllers/classes.controller';
import { ClassesService } from './services/classes.service';
import { GroupClassService } from './services/group-class.service';
import { GroupClassCheckoutService } from './services/group-class-checkout.service';
import { GroupClassFulfilment } from './services/group-class.fulfilment';
import { ClassSession, ClassSessionSchema } from './schemas/class.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { LiveModule } from '../live/live.module';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClassSession.name, schema: ClassSessionSchema },
      // Needed by the cancellation policy: suspend the tutor, alert admins.
      { name: User.name, schema: UserSchema },
    ]),
    LiveModule,
    ChatModule, // provides ChatService + ChatGateway for the Q&A room
    NotificationsModule, // student cancellation notices + admin alerts
    // Seats are sold through the payments module; the dependency runs only
    // this way, and fulfilment comes back via FulfilmentRegistry.
    PaymentsModule,
  ],
  controllers: [ClassesController],
  providers: [
    ClassesService,
    GroupClassService,
    GroupClassCheckoutService,
    GroupClassFulfilment,
  ],
  exports: [ClassesService, GroupClassService],
})
export class ClassesModule {}
