import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  FulfilmentHandler,
  FulfilmentRegistry,
} from '../../payments/services/fulfilment.registry';
import { PaymentDocument } from '../../payments/schemas/payment.schema';
import { RevenueArea } from '../../payments/schemas/platform-settings.schema';
import { GroupClassService } from './group-class.service';

/**
 * Turns a settled class payment into a seat.
 *
 * This is the ONLY caller of `join`, which is what makes "only paying
 * students are in the class" true by construction: there is no route a
 * student can hit to add themselves.
 *
 * Registration happens on startup rather than through a direct call from the
 * payments module, which must not know about classes.
 */
@Injectable()
export class GroupClassFulfilment implements FulfilmentHandler, OnModuleInit {
  constructor(
    private readonly fulfilment: FulfilmentRegistry,
    private readonly groupClasses: GroupClassService,
  ) {}

  onModuleInit(): void {
    this.fulfilment.register(RevenueArea.CLASSES, this);
  }

  /**
   * `referenceId` is the class, `buyerId` the student who paid for the seat.
   *
   * Errors are deliberately not caught. Two students can both reach checkout
   * while one seat remains, so seating can genuinely fail after the money has
   * moved — and that is precisely the case a human must see and refund. The
   * registry logs whatever escapes here; swallowing it would leave a student
   * charged for a class they are not in, with nothing in the logs to find.
   */
  async onPaid(referenceId: string, payment: PaymentDocument): Promise<void> {
    await this.groupClasses.join(referenceId, payment.buyerId.toString());
  }
}
