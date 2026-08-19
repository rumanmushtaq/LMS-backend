import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import {
  PlatformSettings,
  PlatformSettingsSchema,
} from './schemas/platform-settings.schema';
import { PaymentsService } from './services/payments.service';
import { PlatformSettingsService } from './services/platform-settings.service';
import { FulfilmentRegistry } from './services/fulfilment.registry';
import { PaymentProviderRegistry } from './providers/provider.registry';
import { StripeProvider } from './providers/stripe.provider';
import { PseProvider } from './providers/pse.provider';
import { PaymentsController } from './payments.controller';

/**
 * Payments, commission and the seller ledger.
 *
 * Exported so shop / tutor-materials / classes can take payments without
 * knowing which provider is in use.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PlatformSettingsService,
    FulfilmentRegistry,
    PaymentProviderRegistry,
    StripeProvider,
    PseProvider,
  ],
  exports: [PaymentsService, PlatformSettingsService, FulfilmentRegistry],
})
export class PaymentsModule {}
