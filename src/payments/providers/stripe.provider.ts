import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * The installed stripe package exports `Stripe` as a namespace, so the class
 * type has to come from the constructor and the payload shapes are declared
 * structurally rather than as `Stripe.PaymentIntent`.
 */
type StripeClient = InstanceType<typeof Stripe>;

interface PaymentIntentLike {
  id: string;
  status: string;
  amount: number;
  currency?: string;
  metadata?: Record<string, string>;
  client_secret?: string | null;
  last_payment_error?: { message?: string } | null;
}
import {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentProvider,
  ProviderPaymentState,
} from './payment-provider.interface';
import { PaymentStatus } from '../schemas/payment.schema';

/**
 * Card payments via Stripe.
 *
 * Note this creates a PaymentIntent and hands back a client secret — the card
 * itself is collected by Stripe Elements in the browser. The previous shop
 * checkout skipped that entirely: it created an intent, split the client secret
 * to recover the id, immediately asked the server to "confirm", and reported
 * success. No card was ever collected and no money ever moved.
 */
@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe';
  readonly displayName = 'Credit or debit card';
  readonly supportedCurrencies: string[] = [];

  private readonly logger = new Logger(StripeProvider.name);
  private readonly stripe: StripeClient | null = null;
  private readonly webhookSecret?: string;
  private readonly publishableKey?: string;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('stripe.secretKey');
    this.webhookSecret = this.configService.get<string>('stripe.webhookSecret');
    this.publishableKey = this.configService.get<string>(
      'stripe.publishableKey',
    );

    if (secretKey) {
      this.stripe = new Stripe(secretKey);
    }
  }

  isConfigured(): boolean {
    return this.stripe !== null;
  }

  private client(): StripeClient {
    if (!this.stripe) {
      throw new Error(
        'Stripe is not configured (STRIPE_SECRET_KEY is missing)',
      );
    }
    return this.stripe;
  }

  async createPayment(
    request: CreatePaymentRequest,
  ): Promise<CreatePaymentResult> {
    const intent = await this.client().paymentIntents.create(
      {
        amount: request.amountMinor,
        currency: request.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        description: request.description,
        receipt_email: request.buyerEmail,
        // Echoed back on the webhook so we can find our own row without
        // trusting anything the client sends us.
        metadata: { paymentId: request.paymentId },
      },
      // Stripe deduplicates on this key, so a retried checkout cannot create
      // a second charge for the same payment record.
      { idempotencyKey: `payment_${request.paymentId}` },
    );

    return {
      providerRef: intent.id,
      instruction: {
        kind: 'client_secret',
        clientSecret: intent.client_secret!,
        publishableKey: this.publishableKey,
      },
    };
  }

  async parseWebhook(
    rawBody: Buffer | string,
    headers: Record<string, any>,
  ): Promise<ProviderPaymentState | null> {
    if (!this.webhookSecret) {
      // Refuse rather than trust: without the secret we cannot tell a real
      // Stripe event from anyone who found the URL.
      throw new Error(
        'STRIPE_WEBHOOK_SECRET is not configured; refusing to trust webhook',
      );
    }

    const signature = headers['stripe-signature'];
    const event = this.client().webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );

    const intent = event.data.object as PaymentIntentLike;

    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.toState(intent, PaymentStatus.PAID);
      case 'payment_intent.payment_failed':
        return this.toState(
          intent,
          PaymentStatus.FAILED,
          intent.last_payment_error?.message,
        );
      case 'payment_intent.canceled':
        return this.toState(intent, PaymentStatus.CANCELLED);
      default:
        // Everything else is noise we deliberately ignore, but the endpoint
        // still has to 200 or Stripe will retry it forever.
        this.logger.debug(`Ignoring Stripe event ${event.type}`);
        return null;
    }
  }

  async fetchPaymentState(providerRef: string): Promise<ProviderPaymentState> {
    const intent = (await this.client().paymentIntents.retrieve(
      providerRef,
    )) as unknown as PaymentIntentLike;

    const status =
      intent.status === 'succeeded'
        ? PaymentStatus.PAID
        : intent.status === 'canceled'
          ? PaymentStatus.CANCELLED
          : PaymentStatus.PENDING;

    return this.toState(intent, status);
  }

  private toState(
    intent: PaymentIntentLike,
    status: PaymentStatus,
    failureReason?: string,
  ): ProviderPaymentState {
    return {
      providerRef: intent.id,
      status,
      amountMinor: intent.amount,
      currency: intent.currency?.toUpperCase(),
      failureReason,
      raw: { id: intent.id, status: intent.status, metadata: intent.metadata },
    };
  }
}
