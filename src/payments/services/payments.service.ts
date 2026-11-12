import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

/** How long a repeated request waits for the first one's provider call. */
const REPLAY_WAIT_MS = 5000;
const REPLAY_POLL_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** MongoDB's duplicate-key error, raised by a unique index. */
const isDuplicateKeyError = (error: unknown) =>
  (error as { code?: number } | null)?.code === 11000;

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
  /**
   * The client's Idempotency-Key for this checkout attempt. A repeated
   * request with the same key gets the first payment back, not a new one.
   */
  idempotencyKey?: string;
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
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * Where a redirect flow (PSE) sends the buyer back to: the web app's
   * payment-return page, which shows how the payment went.
   */
  private returnUrlFor(paymentId: string, override?: string): string | undefined {
    if (override) return override;
    const base = this.config?.get<string>('app.frontendUrl');
    if (!base) return undefined;
    return `${base.replace(/\/+$/, '')}/payment/return?paymentId=${paymentId}`;
  }

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

    const buyerId = new Types.ObjectId(input.buyerId);
    const key = input.idempotencyKey || null;
    if (key) {
      const existing = await this.paymentModel.findOne({
        buyerId,
        idempotencyKey: key,
      });
      if (existing) return this.replay(existing, input);
    }

    let payment: PaymentDocument;
    try {
      payment = await this.paymentModel.create({
        buyerId,
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
        idempotencyKey: key,
      });
    } catch (error) {
      // Two requests with one key raced past the lookup above; the unique
      // index let only one insert through. Answer with that one.
      if (key && isDuplicateKeyError(error)) {
        const existing = await this.paymentModel.findOne({
          buyerId,
          idempotencyKey: key,
        });
        if (existing) return this.replay(existing, input);
      }
      throw error;
    }

    try {
      const created = await provider.createPayment({
        amountMinor: split.grossMinor,
        currency,
        paymentId: payment._id.toString(),
        description: input.description,
        buyerEmail: input.buyerEmail,
        returnUrl: this.returnUrlFor(payment._id.toString(), input.returnUrl),
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
   * Answers a repeated checkout request with the payment its first request
   * created, so a double-clicked "Pay" never opens a second charge.
   *
   * The provider instruction is asked for again with the same paymentId:
   * Stripe dedupes on `payment_<id>` and hands back the same PaymentIntent,
   * and PSE's redirect URL is derived from the paymentId, so both return what
   * the first request got.
   */
  private async replay(
    existing: PaymentDocument,
    input: StartPaymentInput,
  ): Promise<StartPaymentResult> {
    if (
      existing.provider !== input.providerId ||
      String(existing.referenceId) !== input.referenceId ||
      existing.area !== input.area
    ) {
      throw new ConflictException(
        'This Idempotency-Key was already used for a different checkout',
      );
    }

    // The first request may still be talking to the provider.
    let current: PaymentDocument | null = existing;
    for (
      let waited = 0;
      current?.status === PaymentStatus.PENDING && waited < REPLAY_WAIT_MS;
      waited += REPLAY_POLL_MS
    ) {
      await sleep(REPLAY_POLL_MS);
      current = await this.paymentModel.findById(existing._id);
    }
    if (!current || current.status === PaymentStatus.PENDING) {
      throw new ConflictException('This checkout is already being started');
    }
    if (current.status === PaymentStatus.PAID) {
      throw new BadRequestException('This checkout has already been paid');
    }
    if (current.status !== PaymentStatus.PROCESSING) {
      throw new BadRequestException(
        `This checkout attempt did not go through (${current.failureReason ?? current.status}). Please start a new one.`,
      );
    }

    const provider = this.registry.get(current.provider);
    const created = await provider.createPayment({
      amountMinor: current.grossMinor,
      currency: current.currency,
      paymentId: current._id.toString(),
      description: input.description,
      buyerEmail: input.buyerEmail,
      returnUrl: this.returnUrlFor(current._id.toString(), input.returnUrl),
    });

    return {
      paymentId: current._id.toString(),
      provider: current.provider,
      grossMinor: current.grossMinor,
      commissionMinor: current.commissionMinor,
      netMinor: current.netMinor,
      currency: current.currency,
      instruction: created.instruction,
    };
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

    // Every write below is conditional on the row not being PAID yet, and
    // happens in one atomic findOneAndUpdate. Two deliveries of the same
    // event arriving together both pass the check above, but only one of
    // them can win this write — so fulfilment runs exactly once.
    const notYetPaid = {
      _id: payment._id,
      status: { $ne: PaymentStatus.PAID },
    };

    if (state.status === PaymentStatus.PAID) {
      // Trust the provider's amount over our own record. A mismatch means the
      // buyer was charged something different from what we priced, which must
      // never be fulfilled silently.
      if (
        state.amountMinor !== undefined &&
        state.amountMinor !== payment.grossMinor
      ) {
        await this.paymentModel.findOneAndUpdate(notYetPaid, {
          $set: {
            status: PaymentStatus.FAILED,
            failureReason: `Amount mismatch: charged ${state.amountMinor}, expected ${payment.grossMinor}`,
            providerMetadata: state.raw ?? {},
          },
        });

        this.logger.error(
          `Payment ${payment._id} amount mismatch — charged ${state.amountMinor}, expected ${payment.grossMinor}`,
        );
        return null;
      }

      const settled = await this.paymentModel.findOneAndUpdate(
        notYetPaid,
        {
          $set: {
            status: PaymentStatus.PAID,
            paidAt: new Date(),
            providerMetadata: state.raw ?? {},
          },
        },
        { new: true },
      );
      if (!settled) {
        this.logger.debug(`Ignoring duplicate settlement for ${payment._id}`);
      }
      return settled;
    }

    await this.paymentModel.findOneAndUpdate(notYetPaid, {
      $set: {
        status: state.status,
        failureReason: state.failureReason ?? null,
        providerMetadata: state.raw ?? {},
        // Nothing is owed on money that went back to the buyer.
        ...(state.status === PaymentStatus.REFUNDED
          ? { payoutStatus: PayoutStatus.VOID }
          : {}),
      },
    });
    return null;
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

    // A refund made in the provider's dashboard: sync the ledger and revoke
    // what was bought, exactly as an admin refund does.
    if (state.status === PaymentStatus.REFUNDED) {
      const refunded = await this.applyProviderRefund(state.providerRef);
      if (refunded) await this.fulfilment.refund(refunded);
      return null;
    }

    const settled = await this.applyProviderState(state);

    // Hand off to whichever area this paid for. Only reached when this call is
    // what settled the payment, so a redelivered webhook cannot fulfil twice.
    if (settled) {
      await this.fulfilment.fulfil(settled);
    }

    return settled;
  }

  /**
   * Marks a paid payment refunded because the provider says it was.
   *
   * One conditional write (PAID → REFUNDED), so a redelivered refund event, or
   * one racing an admin refund, revokes access only once. Returns the payment
   * when this call made the change, null otherwise.
   */
  async applyProviderRefund(
    providerRef: string,
  ): Promise<PaymentDocument | null> {
    return this.paymentModel.findOneAndUpdate(
      { providerRef, status: PaymentStatus.PAID },
      {
        $set: {
          status: PaymentStatus.REFUNDED,
          payoutStatus: PayoutStatus.VOID,
          failureReason: 'Refunded at the provider',
        },
      },
      { new: true },
    );
  }

  /**
   * How a buyer's payment stands — what the payment-return page polls while
   * the webhook is on its way. Only the buyer can see their own payment.
   */
  async statusForBuyer(paymentId: string, buyerId: string) {
    if (!Types.ObjectId.isValid(paymentId)) {
      throw new NotFoundException('Payment not found');
    }
    const payment = await this.paymentModel
      .findOne({
        _id: new Types.ObjectId(paymentId),
        buyerId: new Types.ObjectId(buyerId),
      })
      .lean();
    if (!payment) throw new NotFoundException('Payment not found');
    return {
      paymentId: String(payment._id),
      status: payment.status,
      area: payment.area,
      referenceId: String(payment.referenceId),
      grossMinor: payment.grossMinor,
      currency: payment.currency,
      failureReason:
        payment.status === PaymentStatus.FAILED ? payment.failureReason : null,
    };
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
