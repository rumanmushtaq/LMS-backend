import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentProvider,
  ProviderPaymentState,
} from './payment-provider.interface';
import { ProviderPaymentState as State } from './payment-provider.interface';

/**
 * PSE (Pagos Seguros en Línea) — Colombian bank transfer.
 *
 * ## Read this before enabling
 *
 * **Stripe does not support PSE.** Stripe has no Colombian entity offering it;
 * its Latin American coverage is OXXO (Mexico) and Boleto/Pix (Brazil). PSE has
 * to come from a Colombian PSP — Wompi (Bancolombia), Mercado Pago, ePayco,
 * PayU or dLocal.
 *
 * That decision is still open, so this adapter is intentionally **inert**:
 * `isConfigured()` returns false, PSE never appears in the buyer's payment
 * picker, and every method throws rather than returning a plausible-looking
 * success. A payment provider that quietly pretends to work is worse than one
 * that is visibly absent — the shop already had a checkout that reported
 * "Order placed successfully" while charging nobody.
 *
 * ## Filling it in
 *
 * PSE is a redirect flow, which the interface already models:
 *   1. `createPayment` — create the transaction with the PSP, return
 *      `{ kind: 'redirect', redirectUrl }`. The buyer picks their bank on the
 *      PSP's page and authorises there.
 *   2. `parseWebhook` — the PSP posts the outcome. **Verify the signature**
 *      (Wompi signs with an events secret; others use an HMAC of the payload).
 *      Return PAID / FAILED / CANCELLED.
 *   3. `fetchPaymentState` — poll by reference. PSE settlement is asynchronous
 *      and bank redirects are frequently abandoned mid-flow, so reconciliation
 *      by polling matters much more here than it does for cards.
 *
 * Set `PSE_PROVIDER`, `PSE_API_KEY`, `PSE_API_SECRET` and `PSE_WEBHOOK_SECRET`
 * once a PSP is chosen; `isConfigured()` starts returning true and the method
 * appears automatically.
 */
@Injectable()
export class PseProvider implements PaymentProvider {
  readonly id = 'pse';
  readonly displayName = 'PSE — transferencia bancaria';
  /** PSE settles in Colombian pesos only. */
  readonly supportedCurrencies = ['COP'];

  private readonly logger = new Logger(PseProvider.name);
  private readonly psp?: string;
  private readonly apiKey?: string;
  private readonly webhookSecret?: string;

  constructor(private readonly configService: ConfigService) {
    this.psp = this.configService.get<string>('pse.provider');
    this.apiKey = this.configService.get<string>('pse.apiKey');
    this.webhookSecret = this.configService.get<string>('pse.webhookSecret');

    if (this.psp && !this.apiKey) {
      this.logger.warn(
        `PSE_PROVIDER is set to "${this.psp}" but PSE_API_KEY is missing — PSE stays hidden.`,
      );
    }
  }

  isConfigured(): boolean {
    // Requires a chosen PSP *and* its credentials. Until then PSE is not
    // offered, rather than offered and broken.
    return Boolean(this.psp && this.apiKey && this.webhookSecret);
  }

  private notImplemented(): never {
    throw new Error(
      'PSE is not implemented yet: choose a Colombian PSP (Wompi, Mercado Pago, ' +
        'ePayco, PayU or dLocal) and implement PseProvider against its API. ' +
        'Stripe cannot process PSE.',
    );
  }

  async createPayment(
    _request: CreatePaymentRequest,
  ): Promise<CreatePaymentResult> {
    this.notImplemented();
  }

  async parseWebhook(
    _rawBody: Buffer | string,
    _headers: Record<string, any>,
  ): Promise<ProviderPaymentState | null> {
    this.notImplemented();
  }

  async fetchPaymentState(_providerRef: string): Promise<State> {
    this.notImplemented();
  }
}
