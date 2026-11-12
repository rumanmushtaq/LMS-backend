import { AdminTransactionsService } from './admin-transactions.service';
import { PaymentStatus, PayoutStatus } from '../schemas/payment.schema';
import { BadRequestException } from '@nestjs/common';

describe('AdminTransactionsService.refund', () => {
  function setup(status: PaymentStatus, providerId = 'stripe') {
    const payment: any = {
      _id: 'p1',
      provider: providerId,
      providerRef: 'pi_1',
      grossMinor: 500,
      status,
      payoutStatus: PayoutStatus.OWED,
      area: 'shop',
      referenceId: 'o1',
      save: jest.fn().mockResolvedValue(undefined),
      toObject: jest.fn().mockReturnValue({ _id: 'p1' }),
    };
    const model: any = {
      findById: jest.fn().mockResolvedValue(payment),
      // Mirrors the atomic claim: matches only while the row is still PAID.
      findOneAndUpdate: jest.fn(async (filter: any, update: any) => {
        if (payment.status !== filter.status) return null;
        return Object.assign(payment, update.$set);
      }),
      updateOne: jest.fn(async (_filter: any, update: any) => {
        Object.assign(payment, update.$set);
      }),
    };
    const refund = jest.fn().mockResolvedValue(undefined);
    const providerObj = {
      refund,
      displayName: providerId === 'pse' ? 'PSE' : 'Card',
      refundsViaApi: providerId !== 'pse',
    };
    const registry: any = {
      get: jest.fn().mockReturnValue(providerObj),
      getRaw: jest.fn().mockReturnValue(providerObj),
    };
    const fulfilment: any = { refund: jest.fn().mockResolvedValue(undefined) };
    const payments: any = {};
    const resolver: any = {
      resolve: jest
        .fn()
        .mockResolvedValue({ kind: 'order', id: 'o1', label: 'x', available: true }),
    };
    const svc = new AdminTransactionsService(
      model,
      registry,
      payments,
      fulfilment,
      resolver,
    );
    return { svc, payment, refund, fulfilment, model };
  }

  it('rejects refunding a payment that is not paid', async () => {
    const { svc } = setup(PaymentStatus.PENDING);
    await expect(svc.refund('p1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refunds a paid payment and voids the payout', async () => {
    const { svc, payment, refund, fulfilment } = setup(PaymentStatus.PAID);
    await svc.refund('p1', { reason: 'duplicate', amountMinor: 500 });
    expect(refund).toHaveBeenCalledWith('pi_1', undefined, 'refund_p1');
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(payment.payoutStatus).toBe(PayoutStatus.VOID);
    expect(fulfilment.refund).toHaveBeenCalledWith(payment);
  });

  it('refuses a partial refund, which the ledger cannot represent', async () => {
    const { svc, refund, payment } = setup(PaymentStatus.PAID);
    await expect(svc.refund('p1', { amountMinor: 200 })).rejects.toThrow(
      'Only a full refund',
    );
    expect(refund).not.toHaveBeenCalled();
    expect(payment.status).toBe(PaymentStatus.PAID);
  });

  it('sends PSE refunds to the Wompi dashboard instead of calling the API', async () => {
    const { svc, refund } = setup(PaymentStatus.PAID, 'pse');
    await expect(svc.refund('p1', {})).rejects.toThrow("provider's dashboard");
    expect(refund).not.toHaveBeenCalled();
  });

  it('marks a PSE payment refunded once it was refunded in Wompi', async () => {
    const { svc, refund, payment, fulfilment } = setup(PaymentStatus.PAID, 'pse');
    await svc.markRefunded('p1', {});
    expect(refund).not.toHaveBeenCalled();
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(payment.payoutStatus).toBe(PayoutStatus.VOID);
    expect(fulfilment.refund).toHaveBeenCalledWith(payment);
  });

  it('will not mark a card payment refunded by hand — that would skip the money', async () => {
    const { svc, payment } = setup(PaymentStatus.PAID);
    await expect(svc.markRefunded('p1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(payment.status).toBe(PaymentStatus.PAID);
  });

  it('puts the payment back to PAID when the provider refuses the refund', async () => {
    const { svc, payment, refund, fulfilment } = setup(PaymentStatus.PAID);
    refund.mockRejectedValue(new Error('card_declined'));
    await expect(svc.refund('p1', {})).rejects.toThrow('card_declined');
    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(payment.payoutStatus).toBe(PayoutStatus.OWED);
    expect(fulfilment.refund).not.toHaveBeenCalled();
  });
});
