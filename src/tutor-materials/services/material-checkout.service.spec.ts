import { BadRequestException } from '@nestjs/common';
import { RevenueArea } from '../../payments/schemas/platform-settings.schema';
import { MaterialCheckoutService } from './material-checkout.service';

/**
 * Checkout is the mirror of fulfilment: it turns a material into a payment, and
 * the payment turns back into access. Its job is to price it correctly and to
 * refuse obviously-doomed purchases before taking anyone's money.
 */

const MATERIAL_ID = '6a553eed9b1c63e770ebb2a2';
const STUDENT = '6a2858ecf0e15b96bfa4ad08';
const TUTOR = '6a494392b7c2db7ee709dce2';

function makeService(
  overrides: { material?: any; alreadyOwned?: boolean } = {},
) {
  const material = overrides.material ?? {
    _id: MATERIAL_ID,
    tutorId: { _id: { toString: () => TUTOR } },
    title: 'Algebra notes',
    // Stored in cents, as the tutor form saves it: $19.99.
    price: 1999,
    isActive: true,
  };
  const materials: any = {
    findOne: jest.fn().mockResolvedValue(material),
    isPurchasedBy: jest.fn().mockResolvedValue(overrides.alreadyOwned ?? false),
  };
  const payments: any = {
    startPayment: jest.fn().mockResolvedValue({
      paymentId: 'pay-1',
      provider: 'stripe',
      grossMinor: 1999,
      currency: 'USD',
      instruction: { kind: 'client_secret', clientSecret: 'cs' },
    }),
  };
  const settings: any = { currency: jest.fn().mockResolvedValue('USD') };
  const service = new MaterialCheckoutService(materials, payments, settings);
  return { service, materials, payments };
}

describe('buying a material', () => {
  it('charges the price in minor units, to the material’s tutor', async () => {
    const { service, payments } = makeService();

    await service.startPurchase(MATERIAL_ID, STUDENT, 'stripe');

    expect(payments.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerId: STUDENT,
        sellerId: TUTOR,
        area: RevenueArea.MATERIALS,
        referenceId: MATERIAL_ID,
        amountMinor: 1999,
        providerId: 'stripe',
      }),
    );
  });

  it('refuses to charge for a material the student already owns', async () => {
    const { service, payments } = makeService({ alreadyOwned: true });

    await expect(
      service.startPurchase(MATERIAL_ID, STUDENT, 'stripe'),
    ).rejects.toThrow(/already own/i);
    expect(payments.startPayment).not.toHaveBeenCalled();
  });

  it('refuses an inactive material', async () => {
    const { service, payments } = makeService({
      material: {
        _id: MATERIAL_ID,
        tutorId: { _id: { toString: () => TUTOR } },
        title: 'x',
        price: 10,
        isActive: false,
      },
    });

    await expect(
      service.startPurchase(MATERIAL_ID, STUDENT, 'stripe'),
    ).rejects.toThrow(BadRequestException);
    expect(payments.startPayment).not.toHaveBeenCalled();
  });

  it('refuses a free material rather than starting a zero payment', async () => {
    const { service, payments } = makeService({
      material: {
        _id: MATERIAL_ID,
        tutorId: { _id: { toString: () => TUTOR } },
        title: 'x',
        price: 0,
        isActive: true,
      },
    });

    await expect(
      service.startPurchase(MATERIAL_ID, STUDENT, 'stripe'),
    ).rejects.toThrow(BadRequestException);
    expect(payments.startPayment).not.toHaveBeenCalled();
  });
});

/**
 * Material prices are stored in cents (the tutor form saves
 * Math.round(dollars * 100)). These pin what is actually charged, after a
 * bug that billed the stored cents as whole dollars — 100x the price.
 */
describe('MaterialCheckoutService amount', () => {
  function make(price: number, currency: string) {
    const materials: any = {
      findOne: jest.fn().mockResolvedValue({
        _id: 'm1',
        title: 'Notes',
        price,
        isActive: true,
        tutorId: { _id: 't1' },
      }),
      isPurchasedBy: jest.fn().mockResolvedValue(false),
    };
    const payments: any = { startPayment: jest.fn().mockResolvedValue({}) };
    const settings: any = { currency: jest.fn().mockResolvedValue(currency) };
    const svc = new MaterialCheckoutService(materials, payments, settings);
    return { svc, payments };
  }

  it('charges $1.22 for a material stored as 122 cents', async () => {
    const { svc, payments } = make(122, 'USD');
    await svc.startPurchase('m1', 's1', 'stripe');
    expect(payments.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 122 }),
    );
  });

  it('charges 50 pesos (5000 centavos) for a material stored as 5000 in COP', async () => {
    const { svc, payments } = make(5000, 'COP');
    await svc.startPurchase('m1', 's1', 'pse');
    expect(payments.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 5000 }),
    );
  });
});
