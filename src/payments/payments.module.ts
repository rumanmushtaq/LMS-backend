import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Payout, PayoutSchema } from './schemas/payout.schema';
import {
  PlatformSettings,
  PlatformSettingsSchema,
} from './schemas/platform-settings.schema';
import {
  ShopOrder,
  ShopOrderSchema,
} from '../shop/schemas/shop-order.schema';
import { Product, ProductSchema } from '../shop/schemas/product.schema';
import {
  ClassSession,
  ClassSessionSchema,
} from '../classes/schemas/class.schema';
import {
  TutorMaterial,
  TutorMaterialSchema,
} from '../tutor-materials/schemas/tutor-material.schema';
import { ReferenceResolverService } from './services/reference-resolver.service';
import { TutorEarningsService } from './services/tutor-earnings.service';
import { PaymentsService } from './services/payments.service';
import { PlatformSettingsService } from './services/platform-settings.service';
import { FulfilmentRegistry } from './services/fulfilment.registry';
import { AdminTransactionsService } from './services/admin-transactions.service';
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
      { name: Payout.name, schema: PayoutSchema },
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
      // Read-only models for resolving a payment's referenceId to a label.
      { name: ShopOrder.name, schema: ShopOrderSchema },
      { name: Product.name, schema: ProductSchema },
      { name: ClassSession.name, schema: ClassSessionSchema },
      { name: TutorMaterial.name, schema: TutorMaterialSchema },
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
    AdminTransactionsService,
    ReferenceResolverService,
    TutorEarningsService,
  ],
  exports: [
    PaymentsService,
    PlatformSettingsService,
    FulfilmentRegistry,
    AdminTransactionsService,
  ],
})
export class PaymentsModule {}
