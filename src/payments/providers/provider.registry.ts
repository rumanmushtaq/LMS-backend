import { Injectable, BadRequestException } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface';
import { StripeProvider } from './stripe.provider';
import { PseProvider } from './pse.provider';

export interface AvailableMethod {
  id: string;
  displayName: string;
}

/**
 * The set of payment methods the platform can offer.
 *
 * A method is shown to a buyer only when all three hold: it is registered, it
 * has credentials (`isConfigured`), and an admin has enabled it in settings.
 * Anything else is hidden — a buyer should never reach a method that will fail
 * once they commit to it.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(stripe: StripeProvider, pse: PseProvider) {
    this.register(stripe);
    this.register(pse);
  }

  private register(provider: PaymentProvider) {
    this.providers.set(provider.id, provider);
  }

  /** Throws if the id is unknown or unusable, so callers get a clear 400. */
  get(id: string): PaymentProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new BadRequestException(`Unknown payment method: ${id}`);
    }
    if (!provider.isConfigured()) {
      throw new BadRequestException(
        `Payment method "${id}" is not available right now`,
      );
    }
    return provider;
  }

  /** Present regardless of configuration — used by webhook routing. */
  getRaw(id: string): PaymentProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * What to show in the buyer's picker.
   *
   * `enabledIds` comes from admin settings and also fixes the display order.
   */
  availableFor(enabledIds: string[], currency: string): AvailableMethod[] {
    return enabledIds
      .map((id) => this.providers.get(id))
      .filter((p): p is PaymentProvider => Boolean(p))
      .filter((p) => p.isConfigured())
      .filter(
        (p) =>
          p.supportedCurrencies.length === 0 ||
          p.supportedCurrencies.includes(currency.toUpperCase()),
      )
      .map((p) => ({ id: p.id, displayName: p.displayName }));
  }
}
