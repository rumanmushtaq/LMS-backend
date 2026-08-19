import { Injectable, Logger } from '@nestjs/common';
import { RevenueArea } from '../schemas/platform-settings.schema';
import { PaymentDocument } from '../schemas/payment.schema';

/**
 * What a revenue area does once its payment is confirmed.
 *
 * `referenceId` is the domain record the payment was for — a shop order, a
 * material purchase, a class booking.
 */
export interface FulfilmentHandler {
  onPaid(referenceId: string, payment: PaymentDocument): Promise<void>;
  onFailed?(referenceId: string, reason?: string): Promise<void>;
}

/**
 * Lets shop / materials / classes react to a settled payment without the
 * payments module importing any of them.
 *
 * The dependency only runs one way — those modules import payments — so a
 * direct call back into them would be circular. Each registers a handler on
 * startup instead.
 */
@Injectable()
export class FulfilmentRegistry {
  private readonly logger = new Logger(FulfilmentRegistry.name);
  private readonly handlers = new Map<RevenueArea, FulfilmentHandler>();

  register(area: RevenueArea, handler: FulfilmentHandler): void {
    this.handlers.set(area, handler);
  }

  /**
   * Runs the handler for a settled payment.
   *
   * Failures are logged, never thrown: the money has already moved, and
   * throwing here would make the provider retry a webhook we have correctly
   * recorded. Fulfilment problems are an operational issue to chase, not a
   * reason to reject the payment.
   */
  async fulfil(payment: PaymentDocument): Promise<void> {
    const handler = this.handlers.get(payment.area);
    if (!handler) {
      this.logger.warn(
        `Payment ${payment._id} settled for "${payment.area}" but no fulfilment handler is registered`,
      );
      return;
    }

    try {
      await handler.onPaid(payment.referenceId.toString(), payment);
    } catch (error) {
      this.logger.error(
        `Fulfilment failed for payment ${payment._id} (${payment.area}/${payment.referenceId}): ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
}
