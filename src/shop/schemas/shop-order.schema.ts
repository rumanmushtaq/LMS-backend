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

  @ApiProperty({ description: 'Stripe PaymentIntent ID' })
  @Prop({ required: true })
  stripePaymentIntentId: string;

  @ApiProperty({ description: 'Order status' })
  @Prop({ default: 'pending', enum: ['pending', 'paid', 'failed'] })
  status: string;

  @ApiProperty({ description: 'Shipping address' })
  @Prop({ type: Object })
  shippingAddress?: ShippingAddress;
}

export const ShopOrderSchema = SchemaFactory.createForClass(ShopOrder);
ShopOrderSchema.index({ userId: 1 });
ShopOrderSchema.index({ stripePaymentIntentId: 1 }, { unique: true });
ShopOrderSchema.index({ createdAt: -1 });
