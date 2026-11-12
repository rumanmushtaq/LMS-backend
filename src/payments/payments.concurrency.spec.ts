import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Types } from 'mongoose';
import {
  Payment,
  PaymentDocument,
  PaymentSchema,
  PaymentStatus,
  PayoutStatus,
} from './schemas/payment.schema';
import { Payout, PayoutDocument, PayoutSchema } from './schemas/payout.schema';
import { RevenueArea } from './schemas/platform-settings.schema';
import { PayoutService } from './services/payout.service';
import { AdminTransactionsService } from './services/admin-transactions.service';
import { PaymentsService } from './services/payments.service';
import { ShopService } from '../shop/shop.service';
import {
  ShopOrder,
  ShopOrderDocument,
  ShopOrderSchema,
} from '../shop/schemas/shop-order.schema';
import { Product, ProductSchema } from '../shop/schemas/product.schema';

/**
 * Double-clicks and redelivered webhooks are races, and "only one of two
 * concurrent requests wins" is a claim about MongoDB's atomicity that a fake
 * model cannot prove. These run the real services against a real (in-memory)
 * MongoDB with the real schemas, firing the same request twice at once.
 */

jest.setTimeout(60_000);

let mongod: MongoMemoryServer;
let paymentModel: Model<PaymentDocument>;
let payoutModel: Model<PayoutDocument>;

const TUTOR = new Types.ObjectId();
const BUYER = new Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  paymentModel = mongoose.model(
    Payment.name,
    PaymentSchema as any,
  ) as unknown as Model<PaymentDocument>;
  payoutModel = mongoose.model(
    Payout.name,
    PayoutSchema as any,
  ) as unknown as Model<PayoutDocument>;
  await paymentModel.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await paymentModel.deleteMany({});
  await payoutModel.deleteMany({});
});

function paidRow(netMinor: number, extra: Partial<Payment> = {}) {
  return paymentModel.create({
    buyerId: BUYER,
    sellerId: TUTOR,
    area: RevenueArea.MATERIALS,
    referenceId: new Types.ObjectId(),
    provider: 'stripe',
    providerRef: `pi_${new Types.ObjectId().toString()}`,
    grossMinor: netMinor,
    commissionMinor: 0,
    netMinor,
    commissionPercent: 0,
    currency: 'USD',
    status: PaymentStatus.PAID,
    payoutStatus: PayoutStatus.OWED,
    ...extra,
  });
}

describe('PayoutService.record under a double click', () => {
  it('writes one receipt when "pay all owed" is sent twice at once', async () => {
    await paidRow(2125);
    await paidRow(1700);
    const service = new PayoutService(paymentModel as any, payoutModel as any);

    const results = await Promise.allSettled([
      service.record(TUTOR.toString(), { paymentIds: 'all_owed', method: 'bank' }),
      service.record(TUTOR.toString(), { paymentIds: 'all_owed', method: 'bank' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await payoutModel.countDocuments()).toBe(1);

    const payout = await payoutModel.findOne().lean();
    expect(payout!.amountMinor).toBe(3825);
    // Every row is paid out, and by that one receipt.
    const rows = await paymentModel.find().lean();
    expect(rows.every((r) => r.payoutStatus === PayoutStatus.PAID_OUT)).toBe(true);
    expect(rows.every((r) => String(r.payoutId) === String(payout!._id))).toBe(true);
  });

  it('writes one receipt when the same selection is sent twice at once', async () => {
    const a = await paidRow(1000);
    const b = await paidRow(500);
    const ids = [String(a._id), String(b._id)];
    const service = new PayoutService(paymentModel as any, payoutModel as any);

    const results = await Promise.allSettled([
      service.record(TUTOR.toString(), { paymentIds: ids, method: 'bank' }),
      service.record(TUTOR.toString(), { paymentIds: ids, method: 'bank' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await payoutModel.countDocuments()).toBe(1);
    expect((await payoutModel.findOne().lean())!.amountMinor).toBe(1500);
  });

  it('hands the rows back when the receipt cannot be written', async () => {
    await paidRow(800);
    const failingPayouts: any = {
      create: jest.fn().mockRejectedValue(new Error('disk full')),
    };
    const service = new PayoutService(paymentModel as any, failingPayouts);

    await expect(
      service.record(TUTOR.toString(), { paymentIds: 'all_owed', method: 'bank' }),
    ).rejects.toThrow('disk full');

    const row = await paymentModel.findOne().lean();
    expect(row!.payoutStatus).toBe(PayoutStatus.OWED);
    expect(row!.payoutId).toBeNull();
  });
});

describe('AdminTransactionsService.refund under a double click', () => {
  function service(refund: jest.Mock) {
    const provider = { refund, refundsViaApi: true, displayName: 'Card' };
    const registry: any = { get: () => provider, getRaw: () => provider };
    const fulfilment: any = { refund: jest.fn().mockResolvedValue(undefined) };
    return {
      svc: new AdminTransactionsService(
        paymentModel as any,
        registry,
        {} as any,
        fulfilment,
        {} as any,
      ),
      fulfilment,
    };
  }

  it('sends one refund to the provider when "Refund" is clicked twice', async () => {
    const row = await paidRow(1500);
    // A slow provider call widens the window the second click lands in.
    const refund = jest.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 50)),
    );
    const { svc, fulfilment } = service(refund);

    const results = await Promise.allSettled([
      svc.refund(String(row._id), {}),
      svc.refund(String(row._id), {}),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledWith(row.providerRef, undefined, `refund_${row._id}`);
    expect(fulfilment.refund).toHaveBeenCalledTimes(1);
    const after = await paymentModel.findById(row._id).lean();
    expect(after!.status).toBe(PaymentStatus.REFUNDED);
    expect(after!.payoutStatus).toBe(PayoutStatus.VOID);
  });

  it('leaves the payment PAID and owed when the provider refuses', async () => {
    const row = await paidRow(1500);
    const refund = jest.fn().mockRejectedValue(new Error('insufficient_funds'));
    const { svc } = service(refund);

    await expect(svc.refund(String(row._id), {})).rejects.toThrow('insufficient_funds');

    const after = await paymentModel.findById(row._id).lean();
    expect(after!.status).toBe(PaymentStatus.PAID);
    expect(after!.payoutStatus).toBe(PayoutStatus.OWED);
  });
});

describe('PaymentsService.handleWebhook under a redelivered event', () => {
  it('fulfils once when the same "succeeded" event arrives twice at once', async () => {
    const row = await paidRow(2000, {
      status: PaymentStatus.PROCESSING,
      paidAt: null,
    } as any);
    const provider = {
      parseWebhook: jest.fn().mockResolvedValue({
        providerRef: row.providerRef,
        status: PaymentStatus.PAID,
        amountMinor: 2000,
        currency: 'USD',
      }),
    };
    const registry: any = { getRaw: () => provider };
    const fulfilment: any = { fulfil: jest.fn().mockResolvedValue(undefined) };
    const svc = new PaymentsService(
      paymentModel as any,
      {} as any,
      registry,
      fulfilment,
    );

    const settled = await Promise.all([
      svc.handleWebhook('stripe', '{}', {}),
      svc.handleWebhook('stripe', '{}', {}),
    ]);

    expect(settled.filter(Boolean)).toHaveLength(1);
    expect(fulfilment.fulfil).toHaveBeenCalledTimes(1);
    const after = await paymentModel.findById(row._id).lean();
    expect(after!.status).toBe(PaymentStatus.PAID);
    expect(after!.paidAt).toBeInstanceOf(Date);
  });
});

describe('Checkout under a double-clicked "Pay"', () => {
  let orderModel: Model<ShopOrderDocument>;
  let productModel: Model<any>;

  beforeAll(async () => {
    orderModel = mongoose.model(
      ShopOrder.name,
      ShopOrderSchema as any,
    ) as unknown as Model<ShopOrderDocument>;
    productModel = mongoose.model(Product.name, ProductSchema as any);
    await orderModel.syncIndexes();
  });

  beforeEach(async () => {
    await orderModel.deleteMany({});
    await productModel.deleteMany({});
  });

  function payments() {
    // A provider that takes a moment, like a real network call, and answers a
    // repeated paymentId with the same PaymentIntent (as Stripe's
    // idempotency key does).
    const createPayment = jest.fn(async (req: any) => {
      await new Promise((r) => setTimeout(r, 40));
      return {
        providerRef: `pi_${req.paymentId}`,
        instruction: { kind: 'client_secret', clientSecret: `cs_${req.paymentId}` },
      };
    });
    const provider = {
      id: 'stripe',
      displayName: 'Card',
      supportedCurrencies: [],
      createPayment,
    };
    const registry: any = { get: () => provider };
    const settings: any = {
      currency: async () => 'USD',
      commissionPercentFor: async () => 20,
    };
    const svc = new PaymentsService(paymentModel as any, settings, registry, {} as any);
    return { svc, createPayment, settings };
  }

  const start = (svc: PaymentsService, key?: string, referenceId = REF) =>
    svc.startPayment({
      buyerId: BUYER.toString(),
      sellerId: TUTOR.toString(),
      area: RevenueArea.MATERIALS,
      referenceId,
      amountMinor: 1500,
      description: 'Material "Algebra"',
      providerId: 'stripe',
      idempotencyKey: key,
    });
  const REF = new Types.ObjectId().toString();

  it('opens one payment when the same key is sent twice at once', async () => {
    const { svc } = payments();

    const [a, b] = await Promise.all([start(svc, 'key-1'), start(svc, 'key-1')]);

    expect(a.paymentId).toBe(b.paymentId);
    expect(a.instruction).toEqual(b.instruction);
    expect(await paymentModel.countDocuments()).toBe(1);
    expect((await paymentModel.findOne().lean())!.status).toBe(PaymentStatus.PROCESSING);
  });

  it('still opens a new payment per request when no key is sent', async () => {
    const { svc } = payments();

    const [a, b] = await Promise.all([start(svc), start(svc)]);

    expect(a.paymentId).not.toBe(b.paymentId);
    expect(await paymentModel.countDocuments()).toBe(2);
  });

  it('refuses a key reused for a different item', async () => {
    const { svc } = payments();
    await start(svc, 'key-2');

    await expect(
      start(svc, 'key-2', new Types.ObjectId().toString()),
    ).rejects.toThrow('already used for a different checkout');
  });

  it('opens one shop order and one payment for a double-clicked cart checkout', async () => {
    const { svc, settings } = payments();
    const product = await productModel.create({
      title: 'Classic Black T-Shirt',
      description: 'Cotton',
      price: 19.99,
      isActive: true,
    });
    const shop = new ShopService(
      orderModel as any,
      productModel as any,
      { get: () => undefined } as any,
      svc,
      settings,
      { register: jest.fn() } as any,
    );
    const dto: any = {
      items: [{ productId: String(product._id), size: 'M', quantity: 2 }],
      paymentMethod: 'stripe',
    };

    const [a, b] = await Promise.all([
      shop.checkout(BUYER.toString(), dto, undefined, 'cart-key-1'),
      shop.checkout(BUYER.toString(), dto, undefined, 'cart-key-1'),
    ]);

    expect(a.orderId).toBe(b.orderId);
    expect(a.paymentId).toBe(b.paymentId);
    expect(await orderModel.countDocuments()).toBe(1);
    expect(await paymentModel.countDocuments()).toBe(1);
    const order = await orderModel.findOne().lean();
    expect(order!.paymentId).toBe(a.paymentId);

    // The buyer's order history finds it (it used to come back empty).
    const history = await shop.getMyOrders(BUYER.toString());
    expect(history.map((o: any) => String(o._id))).toEqual([a.orderId]);
  });
});

describe('Refunds made at the provider', () => {
  function webhookService(state: any) {
    const provider = { parseWebhook: jest.fn().mockResolvedValue(state) };
    const fulfilment: any = {
      fulfil: jest.fn().mockResolvedValue(undefined),
      refund: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new PaymentsService(
      paymentModel as any,
      {} as any,
      { getRaw: () => provider } as any,
      fulfilment,
    );
    return { svc, fulfilment };
  }

  it('revokes access once when a Stripe dashboard refund is delivered twice at once', async () => {
    const row = await paidRow(2500);
    const { svc, fulfilment } = webhookService({
      providerRef: row.providerRef,
      status: PaymentStatus.REFUNDED,
    });

    await Promise.all([
      svc.handleWebhook('stripe', '{}', {}),
      svc.handleWebhook('stripe', '{}', {}),
    ]);

    expect(fulfilment.refund).toHaveBeenCalledTimes(1);
    const after = await paymentModel.findById(row._id).lean();
    expect(after!.status).toBe(PaymentStatus.REFUNDED);
    expect(after!.payoutStatus).toBe(PayoutStatus.VOID);
  });

  it('marks a PSE payment refunded once when "Mark refunded" is clicked twice', async () => {
    const row = await paidRow(9000, { provider: 'pse' } as any);
    const pse = { refundsViaApi: false, displayName: 'PSE', refund: jest.fn() };
    const fulfilment: any = { refund: jest.fn().mockResolvedValue(undefined) };
    const svc = new AdminTransactionsService(
      paymentModel as any,
      { get: () => pse, getRaw: () => pse } as any,
      {} as any,
      fulfilment,
      {} as any,
    );

    const results = await Promise.allSettled([
      svc.markRefunded(String(row._id), {}),
      svc.markRefunded(String(row._id), {}),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(fulfilment.refund).toHaveBeenCalledTimes(1);
    expect(pse.refund).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.statusForBuyer', () => {
  it('shows a buyer their own payment and hides everyone else\'s', async () => {
    const row = await paidRow(1200);
    const svc = new PaymentsService(paymentModel as any, {} as any, {} as any, {} as any);

    const mine = await svc.statusForBuyer(String(row._id), BUYER.toString());
    expect(mine.status).toBe(PaymentStatus.PAID);
    expect(mine.area).toBe(RevenueArea.MATERIALS);

    await expect(
      svc.statusForBuyer(String(row._id), new Types.ObjectId().toString()),
    ).rejects.toThrow('Payment not found');
    await expect(svc.statusForBuyer('not-an-id', BUYER.toString())).rejects.toThrow(
      'Payment not found',
    );
  });
});
