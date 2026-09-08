import { BadRequestException } from '@nestjs/common';
import { RevenueArea } from '../payments/schemas/platform-settings.schema';
import { MaterialsCheckoutService } from './materials-checkout.service';

/**
 * Buying a material used to be a mock: it wrote a fake payment intent, marked
 * the row paid and handed back the download. No money moved and no commission
 * was ever taken. This is the real thing.
 */

const STUDENT = '6a987be9584429420c0b2299';
const TUTOR = '6a987be9584429420c0b2288';
const MATERIAL = '6a987be9584429420c0b223c';

function makeService(over: { material?: any; existing?: any } = {}) {
  const material = over.material ?? {
    _id: MATERIAL,
    tutorId: { toString: () => TUTOR },
    title: 'Calculus cheat sheet',
    price: 12,
    isActive: true,
    fileUrl: 'https://files/secret.pdf',
  };
  const materialModel: any = {
    findById: jest.fn().mockResolvedValue(material),
  };
  const created: any[] = [];
  // (studentId, materialId) is UNIQUE in the real schema, so a second create
  // for the same pair would throw. The fake enforces that too.
  const rows: any[] = over.existing ? [over.existing] : [];
  const purchaseModel: any = {
    findOne: jest.fn(async (q: any) =>
      rows.find((r) => (q.status ? r.status === q.status : true)) ?? null,
    ),
    create: jest.fn(async (doc: any) => {
      if (rows.length) throw new Error('E11000 duplicate key');
      const row = { ...doc, _id: 'purchase-1' };
      rows.push(row);
      created.push(row);
      return row;
    }),
    findOneAndUpdate: jest.fn(async (_q: any, update: any) => {
      const patch = update.$set ?? update;
      const existing = rows[0];
      if (existing) {
        Object.assign(existing, patch);
        return existing;
      }
      const row = { ...patch, _id: 'purchase-1' };
      rows.push(row);
      created.push(row);
      return row;
    }),
  };
  const payments: any = {
    startPayment: jest.fn().mockResolvedValue({
      paymentId: 'pay-1',
      provider: 'stripe',
      grossMinor: 1200,
      currency: 'USD',
      instruction: { kind: 'redirect', redirectUrl: 'https://pay' },
    }),
  };
  const settings: any = { currency: jest.fn().mockResolvedValue('USD') };
  const service = new MaterialsCheckoutService(
    materialModel,
    purchaseModel,
    payments,
    settings,
  );
  return { service, payments, purchaseModel, created };
}

describe('buying a material', () => {
  it('charges the tutor’s price against the materials revenue area', async () => {
    const { service, payments } = makeService();

    await service.startPurchase(STUDENT, MATERIAL, 'stripe');

    expect(payments.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerId: STUDENT,
        sellerId: TUTOR,
        area: RevenueArea.MATERIALS,
        amountMinor: 1200,
        providerId: 'stripe',
      }),
    );
  });

  /**
   * The download is what the student is paying for, so checkout must not hand
   * it over. It is released by the settled payment, not by asking.
   */
  it('never returns the file before the payment settles', async () => {
    const { service } = makeService();

    const result: any = await service.startPurchase(STUDENT, MATERIAL, 'stripe');

    expect(JSON.stringify(result)).not.toContain('secret.pdf');
    expect(result.instruction).toBeDefined();
  });

  it('records the purchase as pending, not paid', async () => {
    const { service, created } = makeService();

    await service.startPurchase(STUDENT, MATERIAL, 'stripe');

    expect(created[0].status).toBe('pending');
  });

  it('refuses to charge twice for something already owned', async () => {
    const { service, payments } = makeService({
      existing: { _id: 'p1', status: 'paid' },
    });

    await expect(
      service.startPurchase(STUDENT, MATERIAL, 'stripe'),
    ).rejects.toThrow(/already/i);
    expect(payments.startPayment).not.toHaveBeenCalled();
  });

  it('refuses a material the tutor has taken down', async () => {
    const { service, payments } = makeService({
      material: {
        _id: MATERIAL,
        tutorId: { toString: () => TUTOR },
        title: 'x',
        price: 12,
        isActive: false,
      },
    });

    await expect(
      service.startPurchase(STUDENT, MATERIAL, 'stripe'),
    ).rejects.toThrow(BadRequestException);
    expect(payments.startPayment).not.toHaveBeenCalled();
  });

  /**
   * A free material has nothing to charge and no commission to take, and a
   * zero payment would be rejected by the provider — so it is granted outright
   * rather than sent through checkout.
   */
  it('grants a free material without starting a payment', async () => {
    const { service, payments, created } = makeService({
      material: {
        _id: MATERIAL,
        tutorId: { toString: () => TUTOR },
        title: 'Free notes',
        price: 0,
        isActive: true,
        fileUrl: 'https://files/free.pdf',
      },
    });

    const result: any = await service.startPurchase(STUDENT, MATERIAL, 'stripe');

    expect(payments.startPayment).not.toHaveBeenCalled();
    expect(created[0].status).toBe('paid');
    expect(result.downloadUrl).toBe('https://files/free.pdf');
  });
});

describe('retrying after a failed payment', () => {
  /**
   * (studentId, materialId) is unique, so a student whose card was declined
   * must reuse their existing row. Creating a second one throws a duplicate
   * key error and the retry fails for a reason that has nothing to do with
   * their card.
   */
  it('reuses the existing purchase row instead of creating a second', async () => {
    const { service, payments, purchaseModel } = makeService({
      existing: { _id: 'purchase-1', status: 'failed' },
    });

    const result: any = await service.startPurchase(STUDENT, MATERIAL, 'stripe');

    expect(result.status).toBe('payment_required');
    expect(purchaseModel.create).not.toHaveBeenCalled();
    expect(payments.startPayment).toHaveBeenCalled();
  });
});
