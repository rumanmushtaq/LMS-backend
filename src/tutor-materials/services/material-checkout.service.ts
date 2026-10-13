import { BadRequestException, Injectable } from '@nestjs/common';
import { toMinorUnits } from '../../payments/money';
import { RevenueArea } from '../../payments/schemas/platform-settings.schema';
import { PlatformSettingsService } from '../../payments/services/platform-settings.service';
import {
  PaymentsService,
  StartPaymentResult,
} from '../../payments/services/payments.service';
import { TutorMaterialsService } from '../tutor-materials.service';

/**
 * Turns a material into a payment — the mirror of MaterialFulfilment, which
 * turns the settled payment back into access.
 *
 * Like the group-class seat flow, the eligibility checks here are an economy,
 * not a guarantee: they avoid obviously-pointless charges (buying something you
 * already own, or that is unpriced). The access grant itself only happens once
 * the money settles, in MaterialFulfilment.
 */
@Injectable()
export class MaterialCheckoutService {
  constructor(
    private readonly materials: TutorMaterialsService,
    private readonly payments: PaymentsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async startPurchase(
    materialId: string,
    studentId: string,
    providerId: string,
    buyerEmail?: string,
  ): Promise<StartPaymentResult> {
    const material = await this.materials.findOne(materialId); // 404s if missing
    if (!material.isActive) {
      throw new BadRequestException('This material is not available');
    }

    if (await this.materials.isPurchasedBy(studentId, materialId)) {
      throw new BadRequestException('You already own this material');
    }

    const currency = await this.settings.currency();
    const amountMinor = toMinorUnits(material.price ?? 0, currency);
    if (amountMinor <= 0) {
      // A free material has no checkout: the provider would reject a zero
      // charge. Free materials should be granted without payment.
      throw new BadRequestException('This material has no price to charge');
    }

    // findOne populates tutorId, so it may be a User document rather than a raw
    // id — take _id when present, the value itself otherwise.
    const tutorRef = material.tutorId as unknown as
      | { _id?: unknown }
      | null
      | undefined;
    const sellerId = tutorRef
      ? ((tutorRef._id ?? tutorRef) as { toString(): string }).toString()
      : null;

    return this.payments.startPayment({
      buyerId: studentId,
      // The tutor who uploaded it is owed their share; the platform keeps its
      // commission for the MATERIALS area.
      sellerId,
      area: RevenueArea.MATERIALS,
      referenceId: materialId,
      amountMinor,
      description: `Material "${material.title}"`,
      providerId,
      buyerEmail,
    });
  }
}
