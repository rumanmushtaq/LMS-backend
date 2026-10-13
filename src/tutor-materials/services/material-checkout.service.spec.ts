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
    price: 19.99,
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
