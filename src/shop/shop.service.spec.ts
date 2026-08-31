import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShopService } from './shop.service';
import { RevenueArea } from '../payments/schemas/platform-settings.schema';

const USER_ID = '507f1f77bcf86cd799439021';

/**
 * Payment-path coverage for the shop.
 *
 * The properties that matter are unchanged from the previous Stripe-direct
 * implementation: the cart is validated, the amount is computed server-side
 * from the database, and an order only becomes paid on a confirmed payment.
 * What changed is that the shop now goes through PaymentsService rather than
 * calling Stripe itself, and confirmation arrives by webhook instead of the
 * browser asking for it.
 */
function build(
  opts: { products?: Record<string, any>; order?: any; currency?: string } = {},
) {
  const { products = {}, order = null, currency = 'USD' } = opts;

  const savedOrders: any[] = [];
  const shopOrderModel: any = {
    create: jest.fn(async (doc: any) => {
      const o = {
        ...doc,
        _id: 'order-1',
        save: jest.fn().mockResolvedValue(true),
      };
      savedOrders.push(o);
      return o;
    }),
    findById: jest.fn().mockResolvedValue(order),
    findOne: jest.fn().mockResolvedValue(order),
  };

  const productModel: any = {
    findById: jest.fn((id: string) => Promise.resolve(products[id] ?? null)),
  };

  const payments: any = {
    startPayment: jest.fn().mockResolvedValue({
      paymentId: 'pay-1',
      provider: 'stripe',
      grossMinor: 0,
      commissionMinor: 0,
      netMinor: 0,
      currency,
      instruction: { kind: 'client_secret', clientSecret: 'secret_1' },
    }),
  };

  const settings: any = { currency: jest.fn().mockResolvedValue(currency) };
  const fulfilment: any = { register: jest.fn() };

  const service = new ShopService(
    shopOrderModel,
    productModel,
    { get: () => 'sk_test_x' } as any,
    payments,
    settings,
    fulfilment,
  );

  return { service, payments, savedOrders, shopOrderModel, fulfilment };
}

const activeProduct = (id: string, price: number) => ({
  _id: id,
  price,
  isActive: true,
});

const cart = (items: any[], paymentMethod = 'stripe') =>
  ({ items, paymentMethod }) as any;

describe('checkout — cart validation', () => {
  it('rejects a cart referencing a missing product', async () => {
    const { service } = build();
    await expect(
      service.checkout(
        USER_ID,
        cart([{ productId: 'nope', size: 'M', quantity: 1 }]),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an inactive product', async () => {
    const { service } = build({
      products: { p1: { _id: 'p1', price: 10, isActive: false } },
    });
    await expect(
      service.checkout(
        USER_ID,
        cart([{ productId: 'p1', size: 'M', quantity: 1 }]),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a zero total', async () => {
    const { service } = build({ products: { p1: activeProduct('p1', 0) } });
    await expect(
      service.checkout(
        USER_ID,
        cart([{ productId: 'p1', size: 'M', quantity: 1 }]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('checkout — price integrity (server computes the amount)', () => {
  it('charges price*quantity from the DB, not from the client', async () => {
    const { service, payments } = build({
      products: { p1: activeProduct('p1', 24) },
    });

    await service.checkout(
      USER_ID,
      // A client-supplied price is simply not read.
      cart([{ productId: 'p1', size: 'S', quantity: 2, price: 1 } as any]),
    );

    expect(payments.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 4800, area: RevenueArea.SHOP }),
    );
  });

  it('sums multiple line items correctly', async () => {
    const { service, payments } = build({
      products: {
        p1: activeProduct('p1', 19.99),
        p2: activeProduct('p2', 5.5),
      },
    });

    await service.checkout(
      USER_ID,
      cart([
        { productId: 'p1', size: 'M', quantity: 2 },
        { productId: 'p2', size: 'L', quantity: 1 },
      ]),
    );

    // 1999*2 + 550
    expect(payments.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 4548 }),
    );
  });

  it('prices in whole units for a zero-decimal currency', async () => {
    // COP has no cents; multiplying by 100 would charge 100x.
    const { service, payments } = build({
      products: { p1: activeProduct('p1', 50000) },
      currency: 'COP',
    });

    await service.checkout(
      USER_ID,
      cart([{ productId: 'p1', size: 'M', quantity: 1 }]),
    );

    expect(payments.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 50000 }),
    );
  });

  it('persists a pending order before payment is attempted', async () => {
    const { service, savedOrders } = build({
      products: { p1: activeProduct('p1', 24) },
    });

    const result = await service.checkout(
      USER_ID,
      cart([{ productId: 'p1', size: 'S', quantity: 1 }]),
    );

    expect(savedOrders[0].status).toBe('pending');
    expect(savedOrders[0].totalAmount).toBe(24);
    expect(result.orderId).toBe('order-1');
  });

  it('books the sale as first-party, so no tutor is owed commission', async () => {
    const { service, payments } = build({
      products: { p1: activeProduct('p1', 24) },
    });

    await service.checkout(
      USER_ID,
      cart([{ productId: 'p1', size: 'S', quantity: 1 }]),
    );

    expect(payments.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: null }),
    );
  });

  it('passes the buyer-selected payment method through', async () => {
    const { service, payments } = build({
      products: { p1: activeProduct('p1', 24) },
    });

    await service.checkout(
      USER_ID,
      cart([{ productId: 'p1', size: 'S', quantity: 1 }], 'pse'),
    );

    expect(payments.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'pse' }),
    );
  });
});

describe('fulfilment — only a settled payment marks an order paid', () => {
  it('marks the order paid', async () => {
    const order = { _id: 'order-1', status: 'pending', save: jest.fn() };
    const { service } = build({ order });

    await service.onPaid('order-1');

    expect(order.status).toBe('paid');
    expect(order.save).toHaveBeenCalled();
  });

  it('is idempotent — a redelivered webhook does not re-save', async () => {
    const order = { _id: 'order-1', status: 'paid', save: jest.fn() };
    const { service } = build({ order });

    await service.onPaid('order-1');

    expect(order.save).not.toHaveBeenCalled();
  });

  it('marks the order failed when payment fails', async () => {
    const order = { _id: 'order-1', status: 'pending', save: jest.fn() };
    const { service } = build({ order });

    await service.onFailed('order-1', 'card declined');

    expect(order.status).toBe('failed');
  });

  it('never downgrades an already-paid order to failed', async () => {
    const order = { _id: 'order-1', status: 'paid', save: jest.fn() };
    const { service } = build({ order });

    await service.onFailed('order-1', 'late failure event');

    expect(order.status).toBe('paid');
  });

  it('tolerates an unknown order rather than throwing at the webhook', async () => {
    // Throwing would make the provider retry a webhook we handled correctly.
    const { service } = build({ order: null });
    await expect(service.onPaid('missing')).resolves.toBeUndefined();
  });
});

describe('registration', () => {
  it('registers itself as the shop fulfilment handler', () => {
    const { service, fulfilment } = build();
    service.onModuleInit();
    expect(fulfilment.register).toHaveBeenCalledWith(RevenueArea.SHOP, service);
  });
});
