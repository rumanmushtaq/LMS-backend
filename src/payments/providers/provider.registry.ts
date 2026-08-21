import { Injectable, BadRequestException } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface';
import { StripeProvider } from './stripe.provider';
import { PseProvider } from './pse.provider';

/** Why a method cannot be used right now. */
export type MethodStatus =
  /** Selectable — configured and able to charge the active currency. */
  | 'available'
  /** Known but not wired up yet. Shown, not selectable. */
  | 'coming_soon'
  /** Works, but not for the currency the platform is charging in. */
  | 'unavailable';

export interface AvailableMethod {
  id: string;
  displayName: string;
  status: MethodStatus;
  /** Short, buyer-facing explanation for anything not `available`. */
  note?: string;
}

/**
 * The set of payment methods the platform can offer.
 *
 * Admin settings decide which methods appear at all. Of those, each is
 * reported with a status so the checkout can show the full line-up and mark
 * what is not ready yet, rather than silently rendering an empty list.
 *
 * Showing a method is not the same as allowing it: `startPayment` goes through
 * `get()`, which still refuses anything unconfigured.
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
      .map((provider) => this.describe(provider, currency));
  }

  /**
   * Describes a method rather than hiding it.
   *
   * Filtering unconfigured methods out entirely left the checkout with nothing
   * to render before credentials existed, so the payment step looked broken
   * while it was merely incomplete. Listing them with a status lets the UI show
   * the real set of options and mark the ones that are not ready — while
   * `startPayment` still refuses anything that is not `available`, so a
   * "coming soon" method can never take money.
   *
   * Methods an admin has removed from `enabledProviders` are not passed in at
   * all: turning one off is a deliberate choice to hide it.
   */
  private describe(provider: PaymentProvider, currency: string): AvailableMethod {
    if (!provider.isConfigured()) {
      return {
        id: provider.id,
        displayName: provider.displayName,
        status: 'coming_soon',
        note: 'Coming soon',
      };
    }

    const supportsCurrency =
      provider.supportedCurrencies.length === 0 ||
      provider.supportedCurrencies.includes(currency.toUpperCase());

    if (!supportsCurrency) {
      return {
        id: provider.id,
        displayName: provider.displayName,
        status: 'unavailable',
        note: `Not available for ${currency.toUpperCase()}`,
      };
    }

    return {
      id: provider.id,
      displayName: provider.displayName,
      status: 'available',
    };
  }
}
