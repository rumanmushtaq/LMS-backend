import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { ShopOrder, ShopOrderDocument } from './schemas/shop-order.schema';
import { Product, ProductDocument } from './schemas/product.schema';

export interface CheckoutItem {
  productId: string;
  size: string;
  quantity: number;
}

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

@Injectable()
export class ShopService {
  private stripe: InstanceType<typeof Stripe> | null = null;

  constructor(
    @InjectModel(ShopOrder.name)
    private shopOrderModel: Model<ShopOrderDocument>,
    @InjectModel(Product.name)
    private productModel: Model<ProductDocument>,
    private configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('stripe.secretKey');
    if (apiKey) {
      this.stripe = new Stripe(apiKey);
    }
  }

  private getStripe(): InstanceType<typeof Stripe> {
    if (!this.stripe) {
      throw new BadRequestException(
        'Stripe API key is not configured. Please set STRIPE_SECRET_KEY in environment variables.',
      );
    }
    return this.stripe;
  }

  // ─── Create Payment Intent ────────────────────────────────────────────────────
  async createPaymentIntent(
    userId: string,
    items: CheckoutItem[],
    shipping?: ShippingAddress,
  ): Promise<{ clientSecret: string; orderId: string }> {
    if (!items || items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Validate products and compute total
    let totalCents = 0;
    const resolvedItems: any[] = [];

    for (const item of items) {
      const product = await this.productModel.findById(item.productId);
      if (!product || !product.isActive) {
        throw new NotFoundException(
          `Product ${item.productId} not found or inactive`,
        );
      }
      const itemPrice = Math.round(product.price * 100); // convert to cents
      totalCents += itemPrice * item.quantity;
      resolvedItems.push({
        productId: product._id,
        size: item.size,
        quantity: item.quantity,
        price: product.price,
      });
    }

    // Create Stripe PaymentIntent
    const paymentIntent = await this.getStripe().paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { userId },
    });

    // Create pending order record
    const order = new this.shopOrderModel({
      userId,
      items: resolvedItems,
      totalAmount: totalCents / 100,
      stripePaymentIntentId: paymentIntent.id,
      status: 'pending',
      shippingAddress: shipping,
    });
    await order.save();

    return {
      clientSecret: paymentIntent.client_secret!,
      orderId: (order._id as any).toString(),
    };
  }

  // ─── Confirm Payment (called after Stripe confirms) ───────────────────────────
  async confirmPayment(paymentIntentId: string): Promise<ShopOrderDocument> {
    const order = await this.shopOrderModel.findOne({
      stripePaymentIntentId: paymentIntentId,
    });
    if (!order) throw new NotFoundException('Order not found');

    // Verify with Stripe
    const pi = await this.getStripe().paymentIntents.retrieve(paymentIntentId);
    if (pi.status === 'succeeded') {
      order.status = 'paid';
      await order.save();
    } else if (pi.status === 'canceled') {
      order.status = 'failed';
      await order.save();
    }

    return order;
  }

  // ─── Get My Orders ────────────────────────────────────────────────────────────
  async getMyOrders(userId: string): Promise<any[]> {
    return this.shopOrderModel
      .find({ userId })
      .populate('items.productId', 'title images price')
      .sort({ createdAt: -1 })
      .lean();
  }

  // ─── Admin: Get All Orders ────────────────────────────────────────────────────
  async getAllOrders(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, totalCount] = await Promise.all([
      this.shopOrderModel
        .find()
        .populate('userId', 'firstName lastName email')
        .populate('items.productId', 'title images')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.shopOrderModel.countDocuments(),
    ]);
    return { data, totalCount, totalPages: Math.ceil(totalCount / limit) };
  }
}
