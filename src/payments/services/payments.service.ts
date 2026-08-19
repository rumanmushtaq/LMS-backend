import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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
import { PaymentProviderRegistry } from '../providers/provider.registry';
import { PaymentInstruction } from '../providers/payment-provider.interface';
import { splitCommission } from '../money';
import { FulfilmentRegistry } from './fulfilment.registry';

export interface StartPaymentInput {
  buyerId: string;
  /** Null for first-party sales (merch), where the platform is the seller. */
  sellerId: string | null;
  area: RevenueArea;
  /** The order / material / class this pays for. */
  referenceId: string;
  amountMinor: number;
  description: string;
  providerId: string;
  buyerEmail?: string;
  returnUrl?: string;
}

export interface StartPaymentResult {
  paymentId: string;
  provider: string;
  grossMinor: number;
  commissionMinor: number;
  netMinor: number;
  currency: string;
  instruction: PaymentInstruction;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly settings: PlatformSettingsService,
    private readonly registry: PaymentProviderRegistry,
    private readonly fulfilment: FulfilmentRegistry,
  ) {}

  /** Payment methods to offer this buyer, in admin-configured order. */
  async availableMethods() {
    const settings = await this.settings.get();
    return this.registry.availableFor(
      settings.enabledProviders,
      settings.currency,
    );
  }

  /**
   * Creates the ledger row, then asks the provider for payment instructions.
   *
   * The ledger row is written **first and always**, even though the provider
   * call may fail. A payment that exists at the provider but not locally is
   * unreconcilable — the webhook arrives and there is nothing to attach it to.
   */
  async startPayment(input: StartPaymentInput): Promise<StartPaymentResult> {
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new BadRequestException(
        'Payment amount must be a positive integer',
      );
    }

    const provider = this.registry.get(input.providerId);
    const currency = await this.settings.currency();

    if (
      provider.supportedCurrencies.length > 0 &&
      !provider.supportedCurrencies.includes(currency.toUpperCase())
    ) {
      throw new BadRequestException(
        `${provider.displayName} cannot charge in ${currency}`,
      );
    }

    const commissionPercent = await this.settings.commissionPercentFor(
      input.area,
    );
    const split = splitCommission(input.amountMinor, commissionPercent);

    const payment = await this.paymentModel.create({
      buyerId: new Types.ObjectId(input.buyerId),
      sellerId: input.sellerId ? new Types.ObjectId(input.sellerId) : null,
      area: input.area,
      referenceId: new Types.ObjectId(input.referenceId),
      provider: provider.id,
      providerRef: null,
      grossMinor: split.grossMinor,
      commissionMinor: split.commissionMinor,
      netMinor: split.netMinor,
      commissionPercent: split.commissionPercent,
      currency,
      status: PaymentStatus.PENDING,
      payoutStatus: PayoutStatus.OWED,
    });

    try {
      const created = await provider.createPayment({
        amountMinor: split.grossMinor,
        currency,
        paymentId: payment._id.toString(),
        description: input.description,
        buyerEmail: input.buyerEmail,
        returnUrl: input.returnUrl,
      });

      payment.providerRef = created.providerRef;
      payment.status = PaymentStatus.PROCESSING;
      await payment.save();

      return {
        paymentId: payment._id.toString(),
        provider: provider.id,
        grossMinor: split.grossMinor,
        commissionMinor: split.commissionMinor,
        netMinor: split.netMinor,
        currency,
        instruction: created.instruction,
      };
    } catch (error) {
      payment.status = PaymentStatus.FAILED;
      payment.failureReason =
        error instanceof Error
          ? error.message
          : 'Provider rejected the payment';
      await payment.save();

      this.logger.error(
        `Provider ${provider.id} failed to create payment ${payment._id}: ${payment.failureReason}`,
      );
      throw error;
    }
  }

  /**
   * Applies a verified provider state to the ledger.
   *
   * Idempotent by design: providers retry webhooks, and a payment that is
   * already PAID is left untouched. Without that, a redelivered "succeeded"
   * event would re-run whatever fulfilment hangs off this and the platform
   * would count the sale twice.
   *
   * Returns the payment when this call is what settled it, and null when the
   * event was a duplicate or irrelevant — callers use that to decide whether
   * to run fulfilment.
   */
  async applyProviderState(state: {
    providerRef: string;
    status: PaymentStatus;
    amountMinor?: number;
    currency?: string;
    failureReason?: string;
    raw?: Record<string, any>;
  }): Promise<PaymentDocument | null> {
    const payment = await this.paymentModel.findOne({
      providerRef: state.providerRef,
    });

    if (!payment) {
      // Not ours, or created by another environment sharing the same provider
      // account. Log and accept, so the provider stops retrying.
      this.logger.warn(`Webhook for unknown providerRef ${state.providerRef}`);
      return null;
    }

    if (payment.status === PaymentStatus.PAID) {
      this.logger.debug(`Ignoring duplicate settlement for ${payment._id}`);
      return null;
    }

    if (state.status === PaymentStatus.PAID) {
      // Trust the provider's amount over our own record. A mismatch means the
      // buyer was charged something different from what we priced, which must
      // never be fulfilled silently.
      if (
        state.amountMinor !== undefined &&
        state.amountMinor !== payment.grossMinor
      ) {
        payment.status = PaymentStatus.FAILED;
        payment.failureReason = `Amount mismatch: charged ${state.amountMinor}, expected ${payment.grossMinor}`;
        payment.providerMetadata = state.raw ?? {};
        await payment.save();

        this.logger.error(
          `Payment ${payment._id} amount mismatch — charged ${state.amountMinor}, expected ${payment.grossMinor}`,
        );
        return null;
      }

      payment.status = PaymentStatus.PAID;
      payment.paidAt = new Date();
    } else {
      payment.status = state.status;
      payment.failureReason = state.failureReason ?? null;
      if (state.status === PaymentStatus.REFUNDED) {
        // Nothing is owed on money that went back to the buyer.
        payment.payoutStatus = PayoutStatus.VOID;
      }
    }

    payment.providerMetadata = state.raw ?? {};
    await payment.save();

    return payment.status === PaymentStatus.PAID ? payment : null;
  }

  /** Verifies and applies a webhook. Returns the settled payment, if any. */
  async handleWebhook(
    providerId: string,
    rawBody: Buffer | string,
    headers: Record<string, any>,
  ): Promise<PaymentDocument | null> {
    const provider = this.registry.getRaw(providerId);
    if (!provider) {
      throw new NotFoundException(`Unknown payment provider: ${providerId}`);
    }

    const state = await provider.parseWebhook(rawBody, headers);
    if (!state) return null;

    const settled = await this.applyProviderState(state);

    // Hand off to whichever area this paid for. Only reached when this call is
    // what settled the payment, so a redelivered webhook cannot fulfil twice.
    if (settled) {
      await this.fulfilment.fulfil(settled);
    }

    return settled;
  }

  /** Has this reference been paid for? Used to gate access to what was bought. */
  async isPaid(area: RevenueArea, referenceId: string): Promise<boolean> {
    const paid = await this.paymentModel.exists({
      area,
      referenceId: new Types.ObjectId(referenceId),
      status: PaymentStatus.PAID,
    });
    return Boolean(paid);
  }

  /**
   * What the platform owes a seller.
   *
   * This is the number tutor earnings should read. The existing `Order`
   * collection has never been written to by anything, which is why every
   * tutor's earnings chart shows zero.
   */
  async sellerBalance(sellerId: string) {
    const [totals] = await this.paymentModel.aggregate([
      {
        $match: {
          sellerId: new Types.ObjectId(sellerId),
          status: PaymentStatus.PAID,
        },
      },
      {
        $group: {
          _id: null,
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
          count: { $sum: 1 },
        },
      },
    ]);

    return {
      grossMinor: totals?.grossMinor ?? 0,
      commissionMinor: totals?.commissionMinor ?? 0,
      netMinor: totals?.netMinor ?? 0,
      owedMinor: totals?.owedMinor ?? 0,
      paymentCount: totals?.count ?? 0,
    };
  }
}
