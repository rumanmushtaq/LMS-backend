import { BadRequestException } from '@nestjs/common';
import { RevenueArea } from '../../payments/schemas/platform-settings.schema';
import { GroupClassCheckoutService } from './group-class-checkout.service';

/**
 * Checkout is the mirror of fulfilment: it turns a seat into a payment, and
 * the payment turns back into a seat. Its job is to price the seat correctly
 * and to refuse obviously-doomed purchases before taking anyone's money.
 */

const CLASS_ID = '6a987be9584429420c0b223c';
const STUDENT = '6a987be9584429420c0b2299';
const TUTOR = '6a987be9584429420c0b2288';

function makeService(overrides: { cls?: any; seatsLeft?: number } = {}) {
  const cls = overrides.cls ?? {
    _id: CLASS_ID,
    tutorId: { toString: () => TUTOR },
    title: 'Algebra crash course',
    price: 19.99,
    visibility: 'group',
    status: 'SCHEDULED',
    students: [],
    leftStudents: [],
  };
  const groupClasses: any = {
    loadJoinable: jest.fn().mockResolvedValue(cls),
    seatsLeft: jest.fn().mockResolvedValue(overrides.seatsLeft ?? 5),
  };
  const payments: any = {
    startPayment: jest.fn().mockResolvedValue({
      paymentId: 'pay-1',
      provider: 'stripe',
      grossMinor: 1999,
      currency: 'USD',
      instruction: { kind: 'redirect', url: 'https://pay' },
    }),
  };
  const settings: any = { currency: jest.fn().mockResolvedValue('USD') };
  const service = new GroupClassCheckoutService(
    groupClasses,
    payments,
    settings,
  );
  return { service, groupClasses, payments };
}

describe('buying a seat', () => {
  it('charges the seat price in minor units, to the class’s tutor', async () => {
    const { service, payments } = makeService();

    await service.startSeatPurchase(CLASS_ID, STUDENT, 'stripe');

    expect(payments.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerId: STUDENT,
        sellerId: TUTOR,
        area: RevenueArea.CLASSES,
        referenceId: CLASS_ID,
        amountMinor: 1999,
        providerId: 'stripe',
      }),
    );
  });

  /**
   * Charging for a seat that cannot exist creates a refund, and this platform
   * has no automatic refunds — so the cheap check happens before the money.
   */
  it('refuses to take money for a class with no seats left', async () => {
    const { service, payments } = makeService({ seatsLeft: 0 });

    await expect(
      service.startSeatPurchase(CLASS_ID, STUDENT, 'stripe'),
    ).rejects.toThrow(/full/i);
    expect(payments.startPayment).not.toHaveBeenCalled();
  });

  /**
   * Whether this particular student may join is GroupClassService's judgement
   * (and is tested against a real database there). Checkout's part of the
   * contract is that it asks first and does not charge when the answer is no.
   */
  it('never starts a payment when the student may not join', async () => {
    const { service, groupClasses, payments } = makeService();
    groupClasses.loadJoinable.mockRejectedValue(
      new BadRequestException('You left this class and cannot join it again'),
    );

    await expect(
      service.startSeatPurchase(CLASS_ID, STUDENT, 'stripe'),
    ).rejects.toThrow(/left this class/i);
    expect(payments.startPayment).not.toHaveBeenCalled();
  });

  it('refuses a free class rather than starting a zero payment', async () => {
    const { service, payments } = makeService({
      cls: {
        _id: CLASS_ID,
        tutorId: { toString: () => TUTOR },
        title: 'x',
        price: 0,
        visibility: 'group',
        status: 'SCHEDULED',
        students: [],
        leftStudents: [],
      },
    });

    await expect(
      service.startSeatPurchase(CLASS_ID, STUDENT, 'stripe'),
    ).rejects.toThrow(BadRequestException);
    expect(payments.startPayment).not.toHaveBeenCalled();
  });
});
