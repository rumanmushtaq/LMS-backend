import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type PayoutDocument = HydratedDocument<Payout>;

/**
 * A recorded payout to a seller (tutor).
 *
 * The platform collects every payment and owes each seller the net. When an
 * admin pays a tutor out of band (bank transfer, cash), they record it here:
 * this row is the receipt, and the `Payment` rows it settles are flipped to
 * `PAID_OUT` and linked back via `Payment.payoutId`. Amounts are integer minor
 * units. See ../money.ts.
 */
@Schema({ timestamps: true })
export class Payout {
  @ApiProperty({ description: 'Seller (tutor) paid' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  tutorId: Types.ObjectId;

  @ApiProperty({ description: 'Total paid out, in minor units' })
  @Prop({ type: Number, required: true, min: 0 })
  amountMinor: number;

  @ApiProperty()
  @Prop({ type: String, required: true })
  currency: string;

  @ApiProperty({ description: 'How it was paid, e.g. "bank" or "cash"' })
  @Prop({ type: String, required: true })
  method: string;

  @ApiProperty({ description: 'Free-text note', required: false })
  @Prop({ type: String, default: null })
  note: string | null;

  @ApiProperty({
    description: 'External reference, e.g. a bank transfer id',
    required: false,
  })
  @Prop({ type: String, default: null })
  reference: string | null;

  @ApiProperty({ description: 'The Payment rows this payout settled' })
  @Prop({ type: [Types.ObjectId], ref: 'Payment', default: [] })
  paymentIds: Types.ObjectId[];

  @ApiProperty({ description: 'Admin who recorded this payout' })
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;
}

export const PayoutSchema = SchemaFactory.createForClass(Payout);

// "What has this tutor been paid, newest first?"
PayoutSchema.index({ tutorId: 1, createdAt: -1 });
