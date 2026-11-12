import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TutorMaterialsService } from './tutor-materials.service';
import { MaterialCheckoutService } from './services/material-checkout.service';
import { MaterialFulfilment } from './services/material.fulfilment';
import { TutorMaterialsController } from './tutor-materials.controller';
import {
  TutorMaterial,
  TutorMaterialSchema,
} from './schemas/tutor-material.schema';
import {
  MaterialPurchase,
  MaterialPurchaseSchema,
} from './schemas/material-purchase.schema';
import { AdminModule } from '../admin/admin.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TutorMaterial.name, schema: TutorMaterialSchema },
      { name: MaterialPurchase.name, schema: MaterialPurchaseSchema },
    ]),
    AdminModule,
    // Materials are sold through the payments module; the dependency runs only
    // this way, and fulfilment comes back via FulfilmentRegistry.
    PaymentsModule,
  ],
  providers: [
    TutorMaterialsService,
    MaterialCheckoutService,
    MaterialFulfilment,
  ],
  controllers: [TutorMaterialsController],
  exports: [TutorMaterialsService],
})
export class TutorMaterialsModule {}
