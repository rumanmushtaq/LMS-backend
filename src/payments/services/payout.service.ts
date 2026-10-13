import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Payment,
  PaymentDocument,
  PaymentStatus,
  PayoutStatus,
} from '../schemas/payment.schema';
import { Payout, PayoutDocument } from '../schemas/payout.schema';

export interface RecordPayoutInput {
  /** Specific payment ids, or 'all_owed' for everything currently owed. */
  paymentIds?: string[] | 'all_owed';
  method: string;
  note?: string;
  reference?: string;
}

/**
 * Records money paid to a tutor out of band and settles the ledger.
 *
 * The platform pays tutors outside the app; this is where that fact is
 * written. It sums the net of the owed payments being settled, writes one
 * Payout receipt, and flips those Payment rows to PAID_OUT with a link back —
 * so "owed" drops and "paid out" rises everywhere those figures are read.
 */
@Injectable()
export class PayoutService {
  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Payout.name)
    private readonly payoutModel: Model<PayoutDocument>,
  ) {}

  async record(
    tutorId: string,
    input: RecordPayoutInput,
    adminId?: string,
  ): Promise<PayoutDocument> {
    const sellerId = new Types.ObjectId(tutorId);

    let payments: any[];
    if (input.paymentIds && input.paymentIds !== 'all_owed') {
      const ids = input.paymentIds.map((id) => new Types.ObjectId(id));
      payments = await this.paymentModel.find({ _id: { $in: ids } }).lean();
      if (payments.length !== ids.length) {
        throw new BadRequestException('One or more payments were not found');
      }
      for (const p of payments) {
        if (String(p.sellerId) !== String(sellerId)) {
          throw new BadRequestException(
            'A selected payment does not belong to this tutor',
          );
        }
        if (
          p.status !== PaymentStatus.PAID ||
          p.payoutStatus !== PayoutStatus.OWED
        ) {
          throw new BadRequestException(
            'A selected payment is not an owed, paid transaction',
          );
        }
      }
    } else {
      payments = await this.paymentModel
        .find({
          sellerId,
          status: PaymentStatus.PAID,
          payoutStatus: PayoutStatus.OWED,
        })
        .lean();
    }

    if (payments.length === 0) {
      throw new BadRequestException('This tutor has no owed payments to pay out');
    }

    const amountMinor = payments.reduce((s, p) => s + (p.netMinor ?? 0), 0);
    const currency = payments[0].currency;
    const paymentIds = payments.map((p) => p._id);

    const payout = await this.payoutModel.create({
      tutorId: sellerId,
      amountMinor,
      currency,
      method: input.method,
      note: input.note ?? null,
      reference: input.reference ?? null,
      paymentIds,
      createdBy: adminId ? new Types.ObjectId(adminId) : null,
    });

    await this.paymentModel.updateMany(
      { _id: { $in: paymentIds } },
      { $set: { payoutStatus: PayoutStatus.PAID_OUT, payoutId: payout._id } },
    );

    return payout;
  }

  async list(tutorId: string): Promise<PayoutDocument[]> {
    return this.payoutModel
      .find({ tutorId: new Types.ObjectId(tutorId) })
      .sort({ createdAt: -1 })
      .lean() as unknown as Promise<PayoutDocument[]>;
  }
}
