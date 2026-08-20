import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { ShopOrder, ShopOrderDocument } from './schemas/shop-order.schema';
import { Product, ProductDocument } from './schemas/product.schema';
import { PaymentsService } from '../payments/services/payments.service';
import { PlatformSettingsService } from '../payments/services/platform-settings.service';
import { RevenueArea } from '../payments/schemas/platform-settings.schema';
import { PaymentInstruction } from '../payments/providers/payment-provider.interface';
import { toMinorUnits, toMajorUnits } from '../payments/money';
import {
  FulfilmentRegistry,
  FulfilmentHandler,
} from '../payments/services/fulfilment.registry';
import { CheckoutDto } from './dto';

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
export class ShopService implements OnModuleInit, FulfilmentHandler {
  private readonly logger = new Logger(ShopService.name);

  private stripe: InstanceType<typeof Stripe> | null = null;

  constructor(
    @InjectModel(ShopOrder.name)
    private shopOrderModel: Model<ShopOrderDocument>,
    @InjectModel(Product.name)
    private productModel: Model<ProductDocument>,
    private configService: ConfigService,
    private readonly payments: PaymentsService,
    private readonly settings: PlatformSettingsService,
    private readonly fulfilment: FulfilmentRegistry,
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

  /** Take responsibility for fulfilling shop payments once they settle. */
  onModuleInit(): void {
    this.fulfilment.register(RevenueArea.SHOP, this);
  }

  /** FulfilmentHandler — a confirmed payment marks its order paid. */
  async onPaid(referenceId: string): Promise<void> {
    await this.fulfilOrder(referenceId);
  }

  /** FulfilmentHandler — a failed payment marks its order failed. */
  async onFailed(referenceId: string, reason?: string): Promise<void> {
    await this.failOrder(referenceId, reason);
  }

  // ─── Checkout ─────────────────────────────────────────────────────────────

  /**
   * Prices the cart server-side, records the order, and starts a payment.
   *
   * Two things this deliberately does NOT do:
   *  - trust any price or total from the client. Only `productId`, `size` and
   *    `quantity` are read; every amount comes from the database.
   *  - mark the order paid. Only the provider webhook may do that.
   */
  async checkout(
    userId: string,
    dto: CheckoutDto,
    buyerEmail?: string,
  ): Promise<{
    orderId: string;
    paymentId: string;
    provider: string;
    amountMinor: number;
    currency: string;
    instruction: PaymentInstruction;
  }> {
    const currency = await this.settings.currency();

    let totalMinor = 0;
    const resolvedItems: any[] = [];

    for (const item of dto.items) {
      const product = await this.productModel.findById(item.productId);
      if (!product || !product.isActive) {
        throw new NotFoundException(
          `Product ${item.productId} not found or inactive`,
        );
      }

      // Prices are stored as major units (floats); convert once, per currency.
      const unitMinor = toMinorUnits(product.price, currency);
      totalMinor += unitMinor * item.quantity;

      resolvedItems.push({
        productId: product._id,
        size: item.size,
        quantity: item.quantity,
        price: product.price,
      });
    }

    if (totalMinor <= 0) {
      throw new BadRequestException('Order total must be greater than zero');
    }

    const order = await this.shopOrderModel.create({
      userId: new Types.ObjectId(userId),
      items: resolvedItems,
      totalAmount: toMajorUnits(totalMinor, currency),
      status: 'pending',
      shippingAddress: dto.shipping,
    });

    const payment = await this.payments.startPayment({
      buyerId: userId,
      // Merch is a first-party sale: the platform is the seller, so no tutor
      // is owed anything and the whole amount is platform revenue.
      sellerId: null,
      area: RevenueArea.SHOP,
      referenceId: (order._id as Types.ObjectId).toString(),
      amountMinor: totalMinor,
      description: `Order ${(order._id as Types.ObjectId).toString()}`,
      providerId: dto.paymentMethod,
      buyerEmail,
    });

    // Link the order to its ledger row so support can trace a charge.
    order.paymentId = payment.paymentId;
    await order.save();

    return {
      orderId: (order._id as Types.ObjectId).toString(),
      paymentId: payment.paymentId,
      provider: payment.provider,
      amountMinor: payment.grossMinor,
      currency: payment.currency,
      instruction: payment.instruction,
    };
  }

  /**
   * Marks an order paid. Called only from the verified webhook path.
   *
   * Idempotent: PaymentsService already refuses to settle the same payment
   * twice, and this re-check means a replayed call cannot double-fulfil.
   */
  async fulfilOrder(orderId: string): Promise<void> {
    const order = await this.shopOrderModel.findById(orderId);
    if (!order) {
      this.logger.warn(`Cannot fulfil unknown order ${orderId}`);
      return;
    }
    if (order.status === 'paid') return;

    order.status = 'paid';
    await order.save();
    this.logger.log(`Order ${orderId} marked paid`);
  }

  /** Records a failed or cancelled payment against the order. */
  async failOrder(orderId: string, reason?: string): Promise<void> {
    const order = await this.shopOrderModel.findById(orderId);
    if (!order || order.status === 'paid') return;

    order.status = 'failed';
    await order.save();
    this.logger.log(`Order ${orderId} marked failed${reason ? `: ${reason}` : ''}`);
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
