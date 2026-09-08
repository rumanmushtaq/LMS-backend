import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TutorMaterialsService } from './tutor-materials.service';
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
import { MaterialsCheckoutService } from './materials-checkout.service';
import { MaterialsFulfilment } from './materials.fulfilment';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TutorMaterial.name, schema: TutorMaterialSchema },
      { name: MaterialPurchase.name, schema: MaterialPurchaseSchema },
    ]),
    AdminModule,
    // Materials are sold through the shared payments ledger, so the platform
    // commission applies to them like any other revenue area.
    PaymentsModule,
  ],
  providers: [TutorMaterialsService, MaterialsCheckoutService, MaterialsFulfilment],
  controllers: [TutorMaterialsController],
  exports: [TutorMaterialsService, MaterialsCheckoutService],
})
export class TutorMaterialsModule {}
