import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type MaterialPurchaseDocument = HydratedDocument<MaterialPurchase>;

@Schema({ timestamps: true })
export class MaterialPurchase {
  @ApiProperty({ description: 'The student who purchased the material' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @ApiProperty({ description: 'The material that was purchased' })
  @Prop({ type: Types.ObjectId, ref: 'TutorMaterial', required: true })
  materialId: Types.ObjectId;

  @ApiProperty({ description: 'Amount paid in USD cents' })
  @Prop({ required: true, min: 0 })
  amountPaid: number;

  @ApiProperty({ description: 'Stripe PaymentIntent ID' })
  @Prop({ required: true })
  stripePaymentIntentId: string;

  @ApiProperty({ description: 'Purchase status' })
  @Prop({ default: 'pending', enum: ['pending', 'paid', 'failed'] })
  status: string;
}

export const MaterialPurchaseSchema = SchemaFactory.createForClass(MaterialPurchase);
MaterialPurchaseSchema.index({ studentId: 1 });
MaterialPurchaseSchema.index({ materialId: 1 });
MaterialPurchaseSchema.index({ stripePaymentIntentId: 1 }, { unique: true });
MaterialPurchaseSchema.index({ studentId: 1, materialId: 1 }, { unique: true }); // Prevent duplicate purchases
