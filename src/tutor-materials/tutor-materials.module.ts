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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TutorMaterial.name, schema: TutorMaterialSchema },
      { name: MaterialPurchase.name, schema: MaterialPurchaseSchema },
    ]),
    AdminModule,
  ],
  providers: [TutorMaterialsService],
  controllers: [TutorMaterialsController],
  exports: [TutorMaterialsService],
})
export class TutorMaterialsModule {}
