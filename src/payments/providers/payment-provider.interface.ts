import { PaymentStatus } from '../schemas/payment.schema';

/**
 * How a buyer completes the payment once we've created it.
 *
 * The two shapes are genuinely different and the client has to branch on them:
 * a card is confirmed in-page with a client secret, while PSE sends the buyer
 * to their bank's site and they come back later.
 */
export type PaymentInstruction =
  | {
      kind: 'client_secret';
      /** Confirmed in-page, e.g. Stripe Elements. */
      clientSecret: string;
      publishableKey?: string;
    }
  | {
      kind: 'redirect';
      /** Send the buyer here; they return to `returnUrl` afterwards. */
      redirectUrl: string;
    };

export interface CreatePaymentRequest {
  /** Integer minor units. See ../money.ts. */
  amountMinor: number;
  currency: string;
  /** Our Payment._id, so the provider can echo it back on the webhook. */
  paymentId: string;
  description: string;
  buyerEmail?: string;
  /** Where to send the buyer back to after a redirect flow. */
  returnUrl?: string;
}

export interface CreatePaymentResult {
  /** The provider's id for this payment. Stored as `providerRef`. */
  providerRef: string;
  instruction: PaymentInstruction;
}

/** What a verified webhook or a status poll tells us. */
export interface ProviderPaymentState {
  providerRef: string;
  status: PaymentStatus;
  /** What the provider says was actually charged, for reconciliation. */
  amountMinor?: number;
  currency?: string;
  failureReason?: string;
  raw?: Record<string, any>;
}

/**
 * A payment method the platform can offer.
 *
 * Adding a provider means implementing this and registering it — nothing in
 * the shop, materials or classes code should ever mention a provider by name.
 */
export interface PaymentProvider {
  /** Stable id used in settings and stored on Payment.provider. */
  readonly id: string;

  /** Shown in the buyer's payment-method picker. */
  readonly displayName: string;

  /** Currencies this provider can charge. Empty means "no restriction". */
  readonly supportedCurrencies: string[];

  /**
   * False when the provider has no credentials configured, so it is hidden
   * from the picker instead of failing at the moment the buyer commits.
   */
  isConfigured(): boolean;

  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult>;

  /**
   * Verifies a webhook's authenticity and returns what it says.
   *
   * Implementations MUST verify the signature. An unverified webhook is an
   * open endpoint that lets anyone mark any payment as paid.
   */
  parseWebhook(
    rawBody: Buffer | string,
    headers: Record<string, any>,
  ): Promise<ProviderPaymentState | null>;

  /** Authoritative status, used to reconcile when a webhook was missed. */
  fetchPaymentState(providerRef: string): Promise<ProviderPaymentState>;
}
