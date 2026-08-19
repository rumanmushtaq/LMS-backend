import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShopService } from './shop.service';

/**
 * Payment-path coverage for the shop: cart validation, server-side price
 * integrity (the client never dictates the amount), and the confirm flow
 * that trusts Stripe's status rather than the caller's word.
 */
function build(
  opts: {
    products?: Record<string, any>;
    order?: any;
    piStatus?: string;
  } = {},
) {
  const { products = {}, order = null, piStatus = 'succeeded' } = opts;

  const savedOrders: any[] = [];
  const shopOrderModel: any = function (doc: any) {
    const o = {
      ...doc,
      _id: 'order-1',
      save: jest.fn().mockResolvedValue(true),
    };
    savedOrders.push(o);
    return o;
  };
  shopOrderModel.findOne = jest.fn().mockResolvedValue(order);

  const productModel: any = {
    findById: jest.fn((id: string) => Promise.resolve(products[id] ?? null)),
  };

  const paymentIntents = {
    create: jest
      .fn()
      .mockResolvedValue({ id: 'pi_1', client_secret: 'secret_1' }),
    retrieve: jest.fn().mockResolvedValue({ status: piStatus }),
  };

  const service = new ShopService(shopOrderModel, productModel, {
    get: () => 'sk_test_x',
  } as any);
  // Inject a fake Stripe so no network call happens.
  (service as any).stripe = { paymentIntents };
  return { service, paymentIntents, savedOrders };
}

const activeProduct = (id: string, price: number) => ({
  _id: id,
  price,
  isActive: true,
});

describe('createPaymentIntent — cart validation', () => {
  it('rejects an empty cart', async () => {
    const { service } = build();
    await expect(service.createPaymentIntent('u1', [])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a cart referencing a missing product', async () => {
    const { service } = build({ products: {} });
    await expect(
      service.createPaymentIntent('u1', [
        { productId: 'nope', quantity: 1 } as any,
      ]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an inactive product', async () => {
    const { service } = build({
      products: { p1: { _id: 'p1', price: 10, isActive: false } },
    });
    await expect(
      service.createPaymentIntent('u1', [
        { productId: 'p1', quantity: 1 } as any,
      ]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('createPaymentIntent — price integrity (server computes the amount)', () => {
  it('charges price*quantity in cents from the DB, not from the client', async () => {
    const { service, paymentIntents } = build({
      products: { p1: activeProduct('p1', 19.99) },
    });
    const res = await service.createPaymentIntent('u1', [
      { productId: 'p1', quantity: 3 } as any,
    ]);
    // 19.99 * 100 = 1999 cents * 3 = 5997 — never a client-supplied figure.
    expect(paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5997,
        currency: 'usd',
        metadata: { userId: 'u1' },
      }),
    );
    expect(res.clientSecret).toBe('secret_1');
    expect(res.orderId).toBe('order-1');
  });

  it('sums multiple line items correctly', async () => {
    const { service, paymentIntents } = build({
      products: { p1: activeProduct('p1', 10), p2: activeProduct('p2', 2.5) },
    });
    await service.createPaymentIntent('u1', [
      { productId: 'p1', quantity: 2 } as any, // 2000
      { productId: 'p2', quantity: 4 } as any, // 1000
    ]);
    expect(paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3000 }),
    );
  });

  it('persists a pending order bound to the PaymentIntent', async () => {
    const { service, savedOrders } = build({
      products: { p1: activeProduct('p1', 10) },
    });
    await service.createPaymentIntent('u1', [
      { productId: 'p1', quantity: 1 } as any,
    ]);
    expect(savedOrders[0].status).toBe('pending');
    expect(savedOrders[0].stripePaymentIntentId).toBe('pi_1');
    expect(savedOrders[0].totalAmount).toBe(10);
    expect(savedOrders[0].save).toHaveBeenCalled();
  });
});

describe('confirmPayment — trusts Stripe, not the caller', () => {
  it('marks the order paid only when Stripe says succeeded', async () => {
    const order = {
      status: 'pending',
      save: jest.fn().mockResolvedValue(true),
    };
    const { service } = build({ order, piStatus: 'succeeded' });
    const res = await service.confirmPayment('pi_1');
    expect(res.status).toBe('paid');
    expect(order.save).toHaveBeenCalled();
  });

  it('marks the order failed when Stripe says canceled', async () => {
    const order = {
      status: 'pending',
      save: jest.fn().mockResolvedValue(true),
    };
    const { service } = build({ order, piStatus: 'canceled' });
    const res = await service.confirmPayment('pi_1');
    expect(res.status).toBe('failed');
  });

  it('leaves the order pending for an in-between Stripe status', async () => {
    const order = {
      status: 'pending',
      save: jest.fn().mockResolvedValue(true),
    };
    const { service } = build({ order, piStatus: 'processing' });
    const res = await service.confirmPayment('pi_1');
    expect(res.status).toBe('pending'); // not flipped on an unknown status
  });

  it('404s when no order matches the PaymentIntent', async () => {
    const { service } = build({ order: null });
    await expect(service.confirmPayment('pi_missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
