import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type ShopOrderDocument = HydratedDocument<ShopOrder>;

class OrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  size: string;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true })
  price: number;
}

class ShippingAddress {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  line1: string;

  @Prop()
  line2?: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  state: string;

  @Prop({ required: true })
  zip: string;

  @Prop({ required: true })
  country: string;
}

@Schema({ timestamps: true })
export class ShopOrder {
  @ApiProperty({ description: 'User who placed the order' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @ApiProperty({ description: 'Line items in this order' })
  @Prop({ type: [Object], required: true })
  items: OrderItem[];

  @ApiProperty({ description: 'Total amount in USD cents for Stripe' })
  @Prop({ required: true })
  totalAmount: number;

  /**
   * The Payment ledger row covering this order.
   *
   * Optional because the order is written *before* a payment is started: the
   * payment cannot reference an order that does not exist yet, and requiring
   * it here made every checkout fail Mongoose validation.
   */
  @ApiProperty({ description: 'Payment ledger id', required: false })
  @Prop({ type: String, required: false, default: null })
  paymentId: string | null;

  /**
   * @deprecated Superseded by `paymentId`. Kept so existing orders and the
   * unique index they rely on keep working.
   */
  @ApiProperty({ description: 'Legacy Stripe PaymentIntent ID', required: false })
  @Prop({ type: String, required: false, default: null })
  stripePaymentIntentId: string | null;

  @ApiProperty({ description: 'Order status' })
  @Prop({ default: 'pending', enum: ['pending', 'paid', 'failed'] })
  status: string;

  @ApiProperty({ description: 'Shipping address' })
  @Prop({ type: Object })
  shippingAddress?: ShippingAddress;
}

export const ShopOrderSchema = SchemaFactory.createForClass(ShopOrder);
ShopOrderSchema.index({ userId: 1 });
// Partial, because unpaid orders legitimately have no reference yet — a plain
// unique index treats every null as the same value and rejects the second one.
ShopOrderSchema.index(
  { paymentId: 1 },
  { unique: true, partialFilterExpression: { paymentId: { $type: 'string' } } },
);
ShopOrderSchema.index(
  { stripePaymentIntentId: 1 },
  { unique: true, partialFilterExpression: { stripePaymentIntentId: { $type: 'string' } } },
);
ShopOrderSchema.index({ createdAt: -1 });
