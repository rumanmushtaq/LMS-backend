import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type MaterialPurchaseDocument = HydratedDocument<MaterialPurchase>;

/**
 * A student's ownership of one material.
 *
 * This is the access grant: `getPurchasedMaterials` and any download gate read
 * it, and it is written **only** by MaterialFulfilment when a payment settles —
 * never directly from a request. The authoritative money record is the payment
 * ledger (`Payment`, area = materials); this row just says "this student may
 * read this material" and links back to the ledger via `paymentId`.
 */
@Schema({ timestamps: true })
export class MaterialPurchase {
  @ApiProperty({ description: 'The student who purchased the material' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @ApiProperty({ description: 'The material that was purchased' })
  @Prop({ type: Types.ObjectId, ref: 'TutorMaterial', required: true })
  materialId: Types.ObjectId;

  @ApiProperty({ description: 'Amount charged to the buyer, in minor units' })
  @Prop({ required: true, min: 0 })
  amountPaid: number;

  /**
   * The Payment ledger row that paid for this grant. The provider-agnostic
   * replacement for `stripePaymentIntentId`: a purchase can be paid through
   * Stripe or PSE, so the link is to our own ledger, not to a Stripe id.
   */
  @ApiProperty({ description: 'Payment ledger id', required: false })
  @Prop({ type: String, required: false, default: null })
  paymentId: string | null;

  /**
   * @deprecated Superseded by `paymentId`. No longer written for new purchases;
   * kept so the historical mock purchases and their unique index keep working.
   */
  @ApiProperty({ description: 'Legacy Stripe PaymentIntent ID', required: false })
  @Prop({ type: String, required: false, default: null })
  stripePaymentIntentId: string | null;

  @ApiProperty({ description: 'Purchase status' })
  @Prop({ default: 'pending', enum: ['pending', 'paid', 'failed', 'refunded'] })
  status: string;
}

export const MaterialPurchaseSchema =
  SchemaFactory.createForClass(MaterialPurchase);
MaterialPurchaseSchema.index({ studentId: 1 });
MaterialPurchaseSchema.index({ materialId: 1 });
// One grant row per student + material: fulfilment upserts on this key, so a
// student owns a material exactly once however many times a payment is retried.
MaterialPurchaseSchema.index({ studentId: 1, materialId: 1 }, { unique: true });
// Partial, because new purchases leave these null and a plain unique index
// treats every null as the same value and rejects the second one. See
// scripts/fix-material-purchase-index.mjs for dropping the old non-partial one.
MaterialPurchaseSchema.index(
  { paymentId: 1 },
  { unique: true, partialFilterExpression: { paymentId: { $type: 'string' } } },
);
MaterialPurchaseSchema.index(
  { stripePaymentIntentId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripePaymentIntentId: { $type: 'string' } },
  },
);
