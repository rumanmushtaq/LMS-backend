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

    // Claim the rows before writing the receipt. The filter only matches rows
    // still OWED, so two requests racing (a double-clicked "Record payout")
    // cannot both take the same payment: the second claims nothing and stops
    // here instead of writing a second receipt for money already paid out.
    const payoutId = new Types.ObjectId();
    await this.paymentModel.updateMany(
      {
        _id: { $in: payments.map((p) => p._id) },
        sellerId,
        status: PaymentStatus.PAID,
        payoutStatus: PayoutStatus.OWED,
      },
      { $set: { payoutStatus: PayoutStatus.PAID_OUT, payoutId } },
    );
    const claimed = await this.paymentModel.find({ payoutId }).lean();

    const release = () =>
      this.paymentModel.updateMany(
        { payoutId },
        { $set: { payoutStatus: PayoutStatus.OWED, payoutId: null } },
      );

    if (claimed.length === 0) {
      throw new BadRequestException(
        'These payments are already being paid out',
      );
    }
    if (Array.isArray(input.paymentIds) && claimed.length !== payments.length) {
      // Part of an explicit selection was taken by another payout meanwhile;
      // paying out only some of what the admin picked would be a surprise.
      await release();
      throw new BadRequestException(
        'Some selected payments were paid out by another request',
      );
    }

    const amountMinor = claimed.reduce((s, p) => s + (p.netMinor ?? 0), 0);
    const currency = claimed[0].currency;
    const paymentIds = claimed.map((p) => p._id);

    let payout: PayoutDocument;
    try {
      payout = await this.payoutModel.create({
        _id: payoutId,
        tutorId: sellerId,
        amountMinor,
        currency,
        method: input.method,
        note: input.note ?? null,
        reference: input.reference ?? null,
        paymentIds,
        createdBy: adminId ? new Types.ObjectId(adminId) : null,
      });
    } catch (error) {
      // No receipt means nothing was paid out: hand the rows back.
      await release();
      throw error;
    }

    return payout;
  }

  async list(tutorId: string): Promise<PayoutDocument[]> {
    return this.payoutModel
      .find({ tutorId: new Types.ObjectId(tutorId) })
      .sort({ createdAt: -1 })
      .lean() as unknown as Promise<PayoutDocument[]>;
  }
}
