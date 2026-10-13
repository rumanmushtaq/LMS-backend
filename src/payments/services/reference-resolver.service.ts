import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RevenueArea } from '../schemas/platform-settings.schema';
import { ShopOrder, ShopOrderDocument } from '../../shop/schemas/shop-order.schema';
import { Product, ProductDocument } from '../../shop/schemas/product.schema';
import {
  ClassSession,
  ClassSessionDocument,
} from '../../classes/schemas/class.schema';
import {
  TutorMaterial,
  TutorMaterialDocument,
} from '../../tutor-materials/schemas/tutor-material.schema';

export interface ResolvedReference {
  kind: string;
  id: string;
  label: string;
  available: boolean;
}

/**
 * Turns a `Payment.referenceId` into a human label.
 *
 * A payment stores only the id of the thing it paid for (an order, a class, a
 * material). The ledger views need a name, so this looks the record up per
 * area. A record that was since deleted resolves to "Item unavailable" rather
 * than failing the view.
 */
@Injectable()
export class ReferenceResolverService {
  constructor(
    @InjectModel(ShopOrder.name)
    private readonly shopOrderModel: Model<ShopOrderDocument>,
    @InjectModel(ClassSession.name)
    private readonly classModel: Model<ClassSessionDocument>,
    @InjectModel(TutorMaterial.name)
    private readonly materialModel: Model<TutorMaterialDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async resolve(
    area: RevenueArea,
    referenceId: Types.ObjectId | string,
  ): Promise<ResolvedReference> {
    const id = referenceId?.toString?.() ?? String(referenceId);
    try {
      if (area === RevenueArea.CLASSES) {
        const c = await this.classModel.findById(id).lean();
        return c
          ? { kind: 'class', id, label: c.title, available: true }
          : this.missing('class', id);
      }
      if (area === RevenueArea.MATERIALS) {
        const m = await this.materialModel.findById(id).lean();
        return m
          ? { kind: 'material', id, label: m.title, available: true }
          : this.missing('material', id);
      }
      if (area === RevenueArea.SHOP) {
        const o = await this.shopOrderModel.findById(id).lean();
        if (!o) return this.missing('order', id);
        const items: any[] = (o as any).items ?? [];
        const products = await this.productModel
          .find({ _id: { $in: items.map((i) => i.productId) } })
          .lean();
        const nameById = new Map(
          products.map((p: any) => [String(p._id), p.title]),
        );
        const parts = items.map(
          (i) => `${i.quantity}× ${nameById.get(String(i.productId)) ?? 'item'}`,
        );
        return {
          kind: 'order',
          id,
          label: parts.length ? parts.join(', ') : 'Shop order',
          available: true,
        };
      }
    } catch {
      // Fall through to unavailable — a resolution failure must never take the
      // whole transaction view down.
    }
    return this.missing('unknown', id);
  }

  private missing(kind: string, id: string): ResolvedReference {
    return { kind, id, label: 'Item unavailable', available: false };
  }
}
