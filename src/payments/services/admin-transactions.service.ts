import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Payment,
  PaymentDocument,
  PaymentStatus,
  PayoutStatus,
} from '../schemas/payment.schema';
import { PaymentProviderRegistry } from '../providers/provider.registry';
import { PaymentsService } from './payments.service';
import { FulfilmentRegistry } from './fulfilment.registry';
import {
  QueryTransactionsDto,
  RefundTransactionDto,
} from '../dto/query-transactions.dto';

/**
 * Admin-facing reads and actions over the payment ledger.
 *
 * The ledger (`Payment`) is the single source of truth across every revenue
 * area — shop, materials, classes — so one list, summary and detail serve them
 * all. Refund and reconcile are the only mutations, and both go through the
 * provider: nothing here marks money moved on its own.
 */
@Injectable()
export class AdminTransactionsService {
  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly registry: PaymentProviderRegistry,
    private readonly payments: PaymentsService,
    private readonly fulfilment: FulfilmentRegistry,
  ) {}

  private buildFilter(query: QueryTransactionsDto): FilterQuery<PaymentDocument> {
    const filter: FilterQuery<PaymentDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.area) filter.area = query.area;
    if (query.provider) filter.provider = query.provider;
    // Buyer name/email search needs a lookup; providerRef is on the row itself,
    // so the cheap, index-friendly match goes here and name search is a future
    // refinement if needed.
    if (query.q) filter.providerRef = { $regex: query.q, $options: 'i' };
    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt.$gte = new Date(query.from);
      if (query.to) createdAt.$lte = new Date(query.to);
      (filter as Record<string, unknown>).createdAt = createdAt;
    }
    return filter;
  }

  async list(query: QueryTransactionsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sort: Record<string, 1 | -1> = {
      [query.sortBy || 'createdAt']: query.sortOrder === 'asc' ? 1 : -1,
    };
    const filter = this.buildFilter(query);

    const [data, total] = await Promise.all([
      this.paymentModel
        .find(filter)
        .populate('buyerId', 'firstName lastName email')
        .populate('sellerId', 'firstName lastName email')
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.paymentModel.countDocuments(filter),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async summary(query: QueryTransactionsDto) {
    const filter = this.buildFilter(query);
    const rows = await this.paymentModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          grossMinor: { $sum: '$grossMinor' },
          netMinor: { $sum: '$netMinor' },
          commissionMinor: { $sum: '$commissionMinor' },
        },
      },
    ]);

    const byStatus: Record<string, unknown> = {};
    let totalCount = 0;
    let totalGrossMinor = 0;
    for (const r of rows) {
      byStatus[r._id] = {
        count: r.count,
        grossMinor: r.grossMinor,
        netMinor: r.netMinor,
        commissionMinor: r.commissionMinor,
      };
      totalCount += r.count;
      totalGrossMinor += r.grossMinor;
    }
    return { byStatus, totalCount, totalGrossMinor };
  }

  async getOne(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Transaction not found');
    }
    const payment = await this.paymentModel
      .findById(id)
      .populate('buyerId', 'firstName lastName email')
      .populate('sellerId', 'firstName lastName email')
      .lean();
    if (!payment) throw new NotFoundException('Transaction not found');
    return payment;
  }

  async refund(id: string, dto: RefundTransactionDto) {
    const payment = await this.paymentModel.findById(id);
    if (!payment) throw new NotFoundException('Transaction not found');
    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException('Only a paid transaction can be refunded');
    }
    if (!payment.providerRef) {
      throw new BadRequestException(
        'Transaction has no provider reference to refund',
      );
    }

    const provider = this.registry.get(payment.provider);
    await provider.refund(payment.providerRef, dto.amountMinor);

    payment.status = PaymentStatus.REFUNDED;
    payment.payoutStatus = PayoutStatus.VOID;
    payment.failureReason = dto.reason ?? 'Refunded by admin';
    await payment.save();

    await this.fulfilment.refund(payment);
    return payment.toObject();
  }

  async reconcile(id: string) {
    const payment = await this.paymentModel.findById(id);
    if (!payment) throw new NotFoundException('Transaction not found');
    if (!payment.providerRef) {
      throw new BadRequestException(
        'Transaction has no provider reference to reconcile',
      );
    }

    const provider = this.registry.get(payment.provider);
    // Wompi looks transactions up by its own id, recorded on the first webhook.
    const lookupRef =
      (payment.providerMetadata?.wompiId as string) || payment.providerRef;
    const state = await provider.fetchPaymentState(lookupRef);
    const settled = await this.payments.applyProviderState(state);
    if (settled) await this.fulfilment.fulfil(settled);

    return this.getOne(id);
  }
}
