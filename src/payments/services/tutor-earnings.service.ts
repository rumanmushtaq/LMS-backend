import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Payment,
  PaymentDocument,
  PaymentStatus,
  PayoutStatus,
} from '../schemas/payment.schema';
import { RevenueArea } from '../schemas/platform-settings.schema';
import { PlatformSettingsService } from './platform-settings.service';
import { ReferenceResolverService } from './reference-resolver.service';

export interface Balance {
  grossMinor: number;
  commissionMinor: number;
  netMinor: number;
  owedMinor: number;
  paidOutMinor: number;
  paymentCount: number;
}

const zero = (): Balance => ({
  grossMinor: 0,
  commissionMinor: 0,
  netMinor: 0,
  owedMinor: 0,
  paidOutMinor: 0,
  paymentCount: 0,
});

export interface TutorEarnings {
  totals: Balance;
  byArea: Record<'classes' | 'materials', Balance>;
  transactions: { data: any[]; total: number; page: number; limit: number };
  currency: string;
}

/**
 * Per-tutor earnings, derived entirely from the Payment ledger.
 *
 * A tutor earns on classes and materials (shop is first-party, sellerId null).
 * Owed vs paid-out is read from each PAID payment's payoutStatus, so recording
 * a payout immediately shifts the numbers here.
 */
@Injectable()
export class TutorEarningsService {
  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly resolver: ReferenceResolverService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async summary(tutorId: string, page = 1, limit = 20): Promise<TutorEarnings> {
    const sellerId = new Types.ObjectId(tutorId);
    const match = { sellerId, status: PaymentStatus.PAID };

    const rows = await this.paymentModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$area',
          grossMinor: { $sum: '$grossMinor' },
          commissionMinor: { $sum: '$commissionMinor' },
          netMinor: { $sum: '$netMinor' },
          owedMinor: {
            $sum: {
              $cond: [
                { $eq: ['$payoutStatus', PayoutStatus.OWED] },
                '$netMinor',
                0,
              ],
            },
          },
          paidOutMinor: {
            $sum: {
              $cond: [
                { $eq: ['$payoutStatus', PayoutStatus.PAID_OUT] },
                '$netMinor',
                0,
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const byArea: Record<'classes' | 'materials', Balance> = {
      classes: zero(),
      materials: zero(),
    };
    const totals = zero();

    for (const r of rows) {
      const bal: Balance = {
        grossMinor: r.grossMinor ?? 0,
        commissionMinor: r.commissionMinor ?? 0,
        netMinor: r.netMinor ?? 0,
        owedMinor: r.owedMinor ?? 0,
        paidOutMinor: r.paidOutMinor ?? 0,
        paymentCount: r.count ?? 0,
      };
      if (r._id === RevenueArea.CLASSES) byArea.classes = bal;
      else if (r._id === RevenueArea.MATERIALS) byArea.materials = bal;
      totals.grossMinor += bal.grossMinor;
      totals.commissionMinor += bal.commissionMinor;
      totals.netMinor += bal.netMinor;
      totals.owedMinor += bal.owedMinor;
      totals.paidOutMinor += bal.paidOutMinor;
      totals.paymentCount += bal.paymentCount;
    }

    const [docs, total, currency] = await Promise.all([
      this.paymentModel
        .find(match)
        .sort({ paidAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.paymentModel.countDocuments(match),
      this.settings.currency(),
    ]);

    const data = await Promise.all(
      (docs as any[]).map(async (p) => ({
        ...p,
        reference: await this.resolver.resolve(p.area, p.referenceId),
      })),
    );

    return { totals, byArea, transactions: { data, total, page, limit }, currency };
  }
}
