import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { toMinorUnits } from '../payments/money';
import { RevenueArea } from '../payments/schemas/platform-settings.schema';
import { PlatformSettingsService } from '../payments/services/platform-settings.service';
import {
  PaymentsService,
  StartPaymentResult,
} from '../payments/services/payments.service';
import { MaterialPurchase } from './schemas/material-purchase.schema';
import { TutorMaterial } from './schemas/tutor-material.schema';

/** What a student gets back when they start buying a material. */
export type MaterialPurchaseStart =
  | ({ status: 'payment_required'; purchaseId: string } & StartPaymentResult)
  | { status: 'granted'; purchaseId: string; downloadUrl: string };

/**
 * Selling a material.
 *
 * The previous flow was a mock: it minted a fake payment intent, marked the
 * purchase paid and returned the download immediately. No money moved, no
 * commission was taken, and the file was free to anyone who asked. This routes
 * the sale through the payments ledger like every other revenue area, so the
 * platform's commission applies to materials exactly as it does to the shop.
 */
@Injectable()
export class MaterialsCheckoutService {
  constructor(
    @InjectModel(TutorMaterial.name)
    private readonly materialModel: Model<any>,
    @InjectModel(MaterialPurchase.name)
    private readonly purchaseModel: Model<any>,
    private readonly payments: PaymentsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * One row per (student, material) — the pair is unique in the schema, so a
   * student retrying after a declined card must reuse their existing row
   * rather than insert a second and fail on the constraint.
   */
  private async upsertPurchase(
    studentId: string,
    materialId: string,
    patch: { amountPaid: number; status: string },
  ) {
    return this.purchaseModel.findOneAndUpdate(
      {
        studentId: new Types.ObjectId(studentId),
        materialId: new Types.ObjectId(materialId),
      },
      { $set: patch },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  }

  async startPurchase(
    studentId: string,
    materialId: string,
    paymentMethod: string,
  ): Promise<MaterialPurchaseStart> {
    const material = await this.materialModel.findById(materialId);
    if (!material) throw new NotFoundException('Material not found');
    if (!material.isActive) {
      throw new BadRequestException('This material is not available to buy');
    }

    const owned = await this.purchaseModel.findOne({
      studentId: new Types.ObjectId(studentId),
      materialId: new Types.ObjectId(materialId),
      status: 'paid',
    });
    if (owned) {
      throw new BadRequestException('You already own this material');
    }

    const currency = await this.settings.currency();
    const amountMinor = toMinorUnits(material.price ?? 0, currency);

    // Nothing to charge and no commission to take — and a zero payment would
    // be refused by the provider anyway, so a free material is simply granted.
    if (amountMinor <= 0) {
      const granted = await this.upsertPurchase(studentId, materialId, {
        amountPaid: 0,
        status: 'paid',
      });
      return {
        status: 'granted',
        purchaseId: String(granted._id),
        downloadUrl: material.fileUrl,
      };
    }

    // Written before the provider is called: a payment that exists at the
    // provider with no local row to attach the webhook to is unreconcilable.
    const purchase = await this.upsertPurchase(studentId, materialId, {
      amountPaid: material.price,
      status: 'pending',
    });

    const payment = await this.payments.startPayment({
      buyerId: studentId,
      sellerId: material.tutorId?.toString() ?? null,
      area: RevenueArea.MATERIALS,
      referenceId: String(purchase._id),
      amountMinor,
      description: `Material: ${material.title}`,
      providerId: paymentMethod,
    });

    // Deliberately no downloadUrl: the file is what is being paid for, and it
    // is released by MaterialsFulfilment once the money settles.
    return {
      status: 'payment_required',
      purchaseId: String(purchase._id),
      ...payment,
    };
  }
}
