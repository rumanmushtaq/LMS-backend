import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ClassSession,
  ClassSessionSchema,
} from '../classes/schemas/class.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';
import {
  Conversation,
  ConversationSchema,
} from '../chat/schemas/conversation.schema';
import { Message, MessageSchema } from '../chat/schemas/message.schema';
import {
  TutorMaterial,
  TutorMaterialSchema,
} from '../tutor-materials/schemas/tutor-material.schema';
import {
  MaterialPurchase,
  MaterialPurchaseSchema,
} from '../tutor-materials/schemas/material-purchase.schema';
import { PaymentsModule } from '../payments/payments.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * The tutor and student dashboards' single read endpoint.
 *
 * Reads across classes, chat, notifications, materials and the payment ledger
 * but owns none of them, so it registers the schemas it queries rather than
 * depending on the feature modules — nothing here writes.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClassSession.name, schema: ClassSessionSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: TutorMaterial.name, schema: TutorMaterialSchema },
      { name: MaterialPurchase.name, schema: MaterialPurchaseSchema },
    ]),
    // Supplies PaymentsService (the real seller ledger) and
    // PlatformSettingsService (the display currency).
    PaymentsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
