import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  FulfilmentHandler,
  FulfilmentRegistry,
} from '../../payments/services/fulfilment.registry';
import { PaymentDocument } from '../../payments/schemas/payment.schema';
import { RevenueArea } from '../../payments/schemas/platform-settings.schema';
import { TutorMaterialsService } from '../tutor-materials.service';

/**
 * Turns a settled materials payment into access, and a refund back into none.
 *
 * This is the ONLY writer of a paid MaterialPurchase row, which is what makes
 * "only students who paid can read a material" true by construction: there is
 * no request path that grants access directly.
 *
 * Registration happens on startup rather than through a direct call from the
 * payments module, which must not know about materials.
 */
@Injectable()
export class MaterialFulfilment implements FulfilmentHandler, OnModuleInit {
  constructor(
    private readonly fulfilment: FulfilmentRegistry,
    private readonly materials: TutorMaterialsService,
  ) {}

  onModuleInit(): void {
    this.fulfilment.register(RevenueArea.MATERIALS, this);
  }

  /** `referenceId` is the material, `payment.buyerId` the student who paid. */
  async onPaid(referenceId: string, payment: PaymentDocument): Promise<void> {
    await this.materials.grantPurchase({
      studentId: payment.buyerId.toString(),
      materialId: referenceId,
      amountPaidMinor: payment.grossMinor,
      paymentId: payment._id.toString(),
    });
  }

  /** A refund revokes the access the payment granted. */
  async onRefunded(
    referenceId: string,
    payment: PaymentDocument,
  ): Promise<void> {
    await this.materials.revokePurchase(
      payment.buyerId.toString(),
      referenceId,
    );
  }
}
