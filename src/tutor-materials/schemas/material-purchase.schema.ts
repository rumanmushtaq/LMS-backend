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
  /**
   * Legacy: the mock flow wrote a fabricated `pi_mock_…` here. Real sales are
   * reconciled through `paymentId` against the payments ledger, so this is no
   * longer required and is left only so old rows still load.
   */
  // No default: the field must be ABSENT on new rows, not null. The unique
  // index below counts two nulls as a duplicate, so defaulting it would make
  // the second purchase ever created fail.
  @Prop({ required: false })
  stripePaymentIntentId?: string;

  @ApiProperty({ description: 'Row in the payments ledger that paid for this' })
  @Prop({ type: Types.ObjectId, ref: 'Payment', default: null })
  paymentId: Types.ObjectId | null;

  @ApiProperty({ description: 'Purchase status' })
  @Prop({ default: 'pending', enum: ['pending', 'paid', 'failed'] })
  status: string;
}

export const MaterialPurchaseSchema =
  SchemaFactory.createForClass(MaterialPurchase);
MaterialPurchaseSchema.index({ studentId: 1 });
MaterialPurchaseSchema.index({ materialId: 1 });
// Sparse: only legacy mock rows carry this id. Without it, every new purchase
// (which has no intent id at all) would collide on the unique constraint.
MaterialPurchaseSchema.index(
  { stripePaymentIntentId: 1 },
  { unique: true, sparse: true },
);
MaterialPurchaseSchema.index({ studentId: 1, materialId: 1 }, { unique: true }); // Prevent duplicate purchases
