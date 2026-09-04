import { BadRequestException, Injectable } from '@nestjs/common';
import { toMinorUnits } from '../../payments/money';
import { RevenueArea } from '../../payments/schemas/platform-settings.schema';
import { PlatformSettingsService } from '../../payments/services/platform-settings.service';
import {
  PaymentsService,
  StartPaymentResult,
} from '../../payments/services/payments.service';
import { GroupClassService } from './group-class.service';

/**
 * Turns a seat into a payment — the mirror of GroupClassFulfilment, which
 * turns the settled payment back into a seat.
 *
 * The eligibility checks here are an economy, not a guarantee: two students
 * can still pass them for one remaining seat and both pay. They exist because
 * the platform has no automatic refunds, so every avoidable charge is worth
 * avoiding. The authoritative seat check is the atomic one in
 * `GroupClassService.join`, which runs when the money has settled.
 */
@Injectable()
export class GroupClassCheckoutService {
  constructor(
    private readonly groupClasses: GroupClassService,
    private readonly payments: PaymentsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async startSeatPurchase(
    classId: string,
    studentId: string,
    providerId: string,
    buyerEmail?: string,
  ): Promise<StartPaymentResult> {
    const cls = await this.groupClasses.loadJoinable(classId, studentId);

    if (!(await this.groupClasses.seatsLeft(classId))) {
      throw new BadRequestException('This class is full');
    }

    const currency = await this.settings.currency();
    const amountMinor = toMinorUnits(cls.price ?? 0, currency);
    if (amountMinor <= 0) {
      // A free group class has no checkout: there is nothing to charge, and a
      // zero payment would be rejected by the provider anyway. Such a class
      // needs the tutor to add its students directly.
      throw new BadRequestException('This class has no seat price to charge');
    }

    return this.payments.startPayment({
      buyerId: studentId,
      // The tutor teaches it and is owed their share; the platform takes its
      // commission for the CLASSES area.
      sellerId: cls.tutorId?.toString() ?? null,
      area: RevenueArea.CLASSES,
      referenceId: classId,
      amountMinor,
      description: `Seat in "${cls.title}"`,
      providerId,
      buyerEmail,
    });
  }
}
