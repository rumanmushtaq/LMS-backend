import { AdminTransactionsService } from './admin-transactions.service';
import { PaymentStatus, PayoutStatus } from '../schemas/payment.schema';
import { BadRequestException } from '@nestjs/common';

describe('AdminTransactionsService.refund', () => {
  function setup(status: PaymentStatus) {
    const payment: any = {
      _id: 'p1',
      provider: 'stripe',
      providerRef: 'pi_1',
      status,
      payoutStatus: PayoutStatus.OWED,
      area: 'shop',
      referenceId: 'o1',
      save: jest.fn().mockResolvedValue(undefined),
      toObject: jest.fn().mockReturnValue({ _id: 'p1' }),
    };
    const model: any = { findById: jest.fn().mockResolvedValue(payment) };
    const refund = jest.fn().mockResolvedValue(undefined);
    const registry: any = { get: jest.fn().mockReturnValue({ refund }) };
    const fulfilment: any = { refund: jest.fn().mockResolvedValue(undefined) };
    const payments: any = {};
    const svc = new AdminTransactionsService(
      model,
      registry,
      payments,
      fulfilment,
    );
    return { svc, payment, refund, fulfilment };
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
    expect(refund).toHaveBeenCalledWith('pi_1', 500);
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(payment.payoutStatus).toBe(PayoutStatus.VOID);
    expect(fulfilment.refund).toHaveBeenCalledWith(payment);
  });
});
