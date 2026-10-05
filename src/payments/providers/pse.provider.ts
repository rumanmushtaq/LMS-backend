import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentProvider,
  ProviderPaymentState,
} from './payment-provider.interface';
import { PaymentStatus } from '../schemas/payment.schema';

/**
 * PSE (Pagos Seguros en Línea) — Colombian bank transfer, via Wompi (Bancolombia).
 *
 * Redirect flow: we send the buyer to Wompi's hosted checkout with an integrity
 * signature, Wompi redirects them to their bank, and the outcome arrives as a
 * signed events webhook. `providerRef` is our own paymentId (the Wompi
 * `reference`), which is deterministic and keeps the ledger's unique
 * `provider + providerRef` index intact — so a redelivered webhook cannot
 * create a second ledger row.
 *
 * Stays hidden (`isConfigured()` false) until every Wompi credential is set, so
 * PSE is never offered-but-broken. `supportedCurrencies = ['COP']` gates it to
 * Colombian pesos; USD buyers see it as unavailable rather than selectable.
 */
@Injectable()
export class PseProvider implements PaymentProvider {
  readonly id = 'pse';
  readonly displayName = 'PSE — transferencia bancaria';
  /** PSE settles in Colombian pesos only. */
  readonly supportedCurrencies = ['COP'];

  private readonly logger = new Logger(PseProvider.name);
  private readonly psp?: string;
  private readonly publicKey?: string;
  private readonly privateKey?: string;
  private readonly eventsSecret?: string;
  private readonly integritySecret?: string;
  private readonly apiBaseUrl: string;
  private readonly checkoutUrl = 'https://checkout.wompi.co/p/';

  constructor(private readonly configService: ConfigService) {
    this.psp = this.configService.get<string>('pse.provider');
    this.publicKey = this.configService.get<string>('pse.apiKey');
    this.privateKey = this.configService.get<string>('pse.apiSecret');
    this.eventsSecret = this.configService.get<string>('pse.webhookSecret');
    this.integritySecret =
      this.configService.get<string>('pse.integritySecret');
    this.apiBaseUrl =
      this.configService.get<string>('pse.baseUrl') ||
      'https://production.wompi.co/v1';

    if (this.psp === 'wompi' && !this.isConfigured()) {
      this.logger.warn(
        'PSE_PROVIDER is "wompi" but some Wompi credentials are missing — PSE stays hidden.',
      );
    }
  }

  isConfigured(): boolean {
    // Requires Wompi chosen *and* every credential. Until then PSE is not
    // offered, rather than offered and broken.
    return (
      this.psp === 'wompi' &&
      Boolean(this.publicKey) &&
      Boolean(this.privateKey) &&
      Boolean(this.eventsSecret) &&
      Boolean(this.integritySecret)
    );
  }

  async createPayment(
    request: CreatePaymentRequest,
  ): Promise<CreatePaymentResult> {
    if (!this.isConfigured()) {
      throw new Error('Wompi (PSE) is not configured');
    }

    const amountInCents = request.amountMinor;
    const reference = request.paymentId;
    const currency = request.currency.toUpperCase();

    // Wompi's integrity signature: SHA256(reference + amountInCents + currency + integritySecret).
    const integrity = createHash('sha256')
      .update(`${reference}${amountInCents}${currency}${this.integritySecret}`)
      .digest('hex');

    const params = new URLSearchParams({
      'public-key': this.publicKey!,
      currency,
      'amount-in-cents': String(amountInCents),
      reference,
      'signature:integrity': integrity,
    });
    if (request.returnUrl) params.set('redirect-url', request.returnUrl);

    return {
      // Deterministic: our paymentId is Wompi's reference. The webhook echoes
      // it back, so we can find our own row without trusting anything else.
      providerRef: reference,
      instruction: {
        kind: 'redirect',
        redirectUrl: `${this.checkoutUrl}?${params.toString()}`,
      },
    };
  }

  async parseWebhook(
    rawBody: Buffer | string,
    _headers: Record<string, any>,
  ): Promise<ProviderPaymentState | null> {
    if (!this.eventsSecret) {
      // Refuse rather than trust: without the secret we cannot tell a real
      // Wompi event from anyone who found the URL.
      throw new Error(
        'PSE_WEBHOOK_SECRET is not configured; refusing to trust webhook',
      );
    }

    const payload = JSON.parse(rawBody.toString());
    const signature = payload?.signature;
    const transaction = payload?.data?.transaction;
    if (
      !signature?.checksum ||
      !Array.isArray(signature.properties) ||
      !transaction
    ) {
      throw new Error('Malformed Wompi webhook');
    }

    // Wompi signs the concatenation of the values named in signature.properties
    // (dot-paths under `data`), then the event timestamp, then the events secret.
    const concatenated = signature.properties
      .map((path: string) => this.valueAt(payload, path))
      .join('');
    const computed = createHash('sha256')
      .update(`${concatenated}${payload.timestamp}${this.eventsSecret}`)
      .digest('hex');

    if (computed !== signature.checksum) {
      throw new Error('Wompi webhook signature verification failed');
    }

    return {
      providerRef: String(transaction.reference),
      status: this.mapStatus(transaction.status),
      amountMinor: transaction.amount_in_cents,
      currency: transaction.currency,
      failureReason: transaction.status_message,
      raw: {
        wompiId: transaction.id,
        status: transaction.status,
        reference: transaction.reference,
      },
    };
  }

  async fetchPaymentState(providerRef: string): Promise<ProviderPaymentState> {
    // Wompi's public API looks transactions up by its own id, so reconcile
    // passes the stored Wompi id (payment.providerMetadata.wompiId). If only our
    // reference is available, this call will 404 — reconcile depends on having
    // seen at least one webhook that recorded the Wompi id.
    const res = await fetch(`${this.apiBaseUrl}/transactions/${providerRef}`, {
      headers: { Authorization: `Bearer ${this.privateKey}` },
    });
    if (!res.ok) {
      throw new Error(`Wompi transaction lookup failed: ${res.status}`);
    }
    const body = await res.json();
    const t = body?.data;
    return {
      providerRef: String(t.reference ?? providerRef),
      status: this.mapStatus(t.status),
      amountMinor: t.amount_in_cents,
      currency: t.currency,
      raw: { wompiId: t.id, status: t.status },
    };
  }

  async refund(_providerRef: string, _amountMinor?: number): Promise<void> {
    throw new Error(
      'PSE/Wompi refunds are handled in the Wompi dashboard, not via API',
    );
  }

  private mapStatus(status: string): PaymentStatus {
    switch (status) {
      case 'APPROVED':
        return PaymentStatus.PAID;
      case 'DECLINED':
      case 'ERROR':
        return PaymentStatus.FAILED;
      case 'VOIDED':
        return PaymentStatus.CANCELLED;
      default:
        // PENDING and anything unexpected: still in flight.
        return PaymentStatus.PROCESSING;
    }
  }

  /** Resolves a dot-path like "transaction.amount_in_cents" against payload.data. */
  private valueAt(payload: any, path: string): string {
    const value = path
      .split('.')
      .reduce((acc, key) => (acc == null ? acc : acc[key]), payload.data);
    return String(value);
  }
}
