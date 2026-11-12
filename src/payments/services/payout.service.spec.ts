import { BadRequestException } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { PaymentStatus, PayoutStatus } from '../schemas/payment.schema';

const TUTOR = '6a2858ecf0e15b96bfa4ad08';
const A = '6a2858ecf0e15b96bfa4ad11';
const B = '6a2858ecf0e15b96bfa4ad22';

const owed = (id: string, net: number) => ({
  _id: id,
  sellerId: TUTOR,
  status: PaymentStatus.PAID,
  payoutStatus: PayoutStatus.OWED,
  netMinor: net,
  currency: 'USD',
});

function make(found: any[]) {
  const paymentModel: any = {
    find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(found) })),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: found.length }),
  };
  const payoutModel: any = {
    create: jest.fn(async (doc: any) => ({ _id: 'po1', ...doc })),
    find: jest.fn(() => ({
      sort: () => ({ lean: jest.fn().mockResolvedValue([{ _id: 'po1' }]) }),
    })),
  };
  const service = new PayoutService(paymentModel, payoutModel);
  return { service, paymentModel, payoutModel };
}

describe('PayoutService.record', () => {
  it('pays out all owed: sums net, creates a payout, flips payments to PAID_OUT', async () => {
    const { service, paymentModel, payoutModel } = make([
      owed(A, 2125),
      owed(B, 1700),
    ]);
    const payout = await service.record(
      TUTOR,
      { paymentIds: 'all_owed', method: 'bank' },
      '6a2858ecf0e15b96bfa4adff',
    );
    expect(payout.amountMinor).toBe(3825);
    expect(payoutModel.create).toHaveBeenCalledTimes(1);
    expect(paymentModel.updateMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ payoutStatus: PayoutStatus.PAID_OUT }),
      }),
    );
  });

  it('rejects when the tutor has nothing owed', async () => {
    const { service, payoutModel } = make([]);
    await expect(
      service.record(TUTOR, { paymentIds: 'all_owed', method: 'bank' }, '6a2858ecf0e15b96bfa4adff'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(payoutModel.create).not.toHaveBeenCalled();
  });

  it('rejects a selected payment not owned by the tutor', async () => {
    const foreign = { ...owed(A, 1000), sellerId: 'someoneelse000000000000x' };
    const { service, payoutModel } = make([foreign]);
    await expect(
      service.record(TUTOR, { paymentIds: [A], method: 'bank' }, '6a2858ecf0e15b96bfa4adff'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(payoutModel.create).not.toHaveBeenCalled();
  });

  it('rejects a selected payment already paid out', async () => {
    const paid = { ...owed(A, 1000), payoutStatus: PayoutStatus.PAID_OUT };
    const { service, payoutModel } = make([paid]);
    await expect(
      service.record(TUTOR, { paymentIds: [A], method: 'bank' }, '6a2858ecf0e15b96bfa4adff'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(payoutModel.create).not.toHaveBeenCalled();
  });
});

describe('PayoutService.list', () => {
  it('returns the tutor payout history', async () => {
    const { service } = make([]);
    const list = await service.list(TUTOR);
    expect(list).toHaveLength(1);
  });
});
