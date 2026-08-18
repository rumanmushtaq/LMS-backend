import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { RevenueArea } from './platform-settings.schema';

export type PaymentDocument = HydratedDocument<Payment>;

export enum PaymentStatus {
  /** Created locally; the provider has not confirmed anything yet. */
  PENDING = 'pending',
  /** Buyer sent to the provider (PSE redirects the buyer to their bank). */
  PROCESSING = 'processing',
  /** Provider confirmed the money moved. Only a webhook may set this. */
  PAID = 'paid',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum PayoutStatus {
  /** The platform holds this money and owes it to the seller. */
  OWED = 'owed',
  PAID_OUT = 'paid_out',
  /** Refunded before payout, so nothing is owed. */
  VOID = 'void',
}

/**
 * One payment attempt and its commission split.
 *
 * This is the ledger. The platform collects the full amount, so for every paid
 * row the business owes `netMinor` to `sellerId` until a payout clears it.
 * `Order` (the existing collection) is never written by anything, which is why
 * tutor earnings have always read zero — earnings should be derived from here.
 *
 * Amounts are integer minor units. See ../money.ts.
 */
@Schema({ timestamps: true })
export class Payment {
  @ApiProperty({ description: 'Buyer' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  buyerId: Types.ObjectId;

  @ApiProperty({
    description:
      'Seller owed the net. Null for first-party sales such as the merch shop, where the platform is the seller.',
  })
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  sellerId: Types.ObjectId | null;

  @ApiProperty({ enum: RevenueArea })
  @Prop({ type: String, enum: RevenueArea, required: true, index: true })
  area: RevenueArea;

  @ApiProperty({
    description: 'Domain record this pays for (order, material, class)',
  })
  @Prop({ type: Types.ObjectId, required: true, index: true })
  referenceId: Types.ObjectId;

  @ApiProperty({ description: 'Provider id, e.g. "stripe" or "pse"' })
  @Prop({ type: String, required: true, index: true })
  provider: string;

  @ApiProperty({ description: "The provider's own id for this payment" })
  @Prop({ type: String, default: null })
  providerRef: string | null;

  @ApiProperty({ description: 'Charged to the buyer, in minor units' })
  @Prop({ type: Number, required: true, min: 0 })
  grossMinor: number;

  @ApiProperty({ description: 'Kept by the platform, in minor units' })
  @Prop({ type: Number, required: true, min: 0 })
  commissionMinor: number;

  @ApiProperty({ description: 'Owed to the seller, in minor units' })
  @Prop({ type: Number, required: true, min: 0 })
  netMinor: number;

  @ApiProperty({ description: 'Rate applied, kept for the audit trail' })
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  commissionPercent: number;

  @ApiProperty()
  @Prop({ type: String, required: true })
  currency: string;

  @ApiProperty({ enum: PaymentStatus })
  @Prop({
    type: String,
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
    index: true,
  })
  status: PaymentStatus;

  @ApiProperty({ enum: PayoutStatus })
  @Prop({
    type: String,
    enum: PayoutStatus,
    default: PayoutStatus.OWED,
    index: true,
  })
  payoutStatus: PayoutStatus;

  @ApiProperty({ description: 'When the provider confirmed payment' })
  @Prop({ type: Date, default: null })
  paidAt: Date | null;

  @ApiProperty({ description: 'Why it failed, when it did' })
  @Prop({ type: String, default: null })
  failureReason: string | null;

  @ApiProperty({ description: 'Raw provider payload, for reconciliation' })
  @Prop({ type: Object, default: {} })
  providerMetadata: Record<string, any>;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

// One payment per provider reference. This is what makes webhook handling
// idempotent: providers retry deliveries, and without it a repeated
// "payment succeeded" event would create a second ledger row and the platform
// would believe it owes the seller twice.
PaymentSchema.index(
  { provider: 1, providerRef: 1 },
  {
    unique: true,
    partialFilterExpression: { providerRef: { $type: 'string' } },
  },
);

// "What do we owe this tutor?"
PaymentSchema.index({ sellerId: 1, status: 1, payoutStatus: 1 });
// Earnings charts read by month.
PaymentSchema.index({ sellerId: 1, paidAt: -1 });
