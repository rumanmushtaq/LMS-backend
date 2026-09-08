import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FulfilmentHandler,
  FulfilmentRegistry,
} from '../payments/services/fulfilment.registry';
import { PaymentDocument } from '../payments/schemas/payment.schema';
import { RevenueArea } from '../payments/schemas/platform-settings.schema';
import { MaterialPurchase } from './schemas/material-purchase.schema';

/**
 * Releases a material once its payment settles.
 *
 * This is the only thing that marks a purchase paid, which is what makes
 * "the download is what you paid for" true: nothing the browser sends can
 * reach it, only a verified webhook.
 */
@Injectable()
export class MaterialsFulfilment implements FulfilmentHandler, OnModuleInit {
  constructor(
    private readonly fulfilment: FulfilmentRegistry,
    @InjectModel(MaterialPurchase.name)
    private readonly purchaseModel: Model<any>,
  ) {}

  onModuleInit(): void {
    this.fulfilment.register(RevenueArea.MATERIALS, this);
  }

  /** `referenceId` is the purchase row the checkout wrote before paying. */
  async onPaid(referenceId: string, payment: PaymentDocument): Promise<void> {
    await this.purchaseModel.updateOne(
      { _id: new Types.ObjectId(referenceId) },
      { $set: { status: 'paid', paymentId: payment._id } },
    );
  }

  /**
   * A declined card leaves the row failed rather than pending, so the student
   * sees why nothing happened and the retry path has something to reuse.
   */
  async onFailed(referenceId: string): Promise<void> {
    await this.purchaseModel.updateOne(
      { _id: new Types.ObjectId(referenceId), status: { $ne: 'paid' } },
      { $set: { status: 'failed' } },
    );
  }
}
