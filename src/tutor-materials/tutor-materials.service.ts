import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TutorMaterial,
  TutorMaterialDocument,
} from './schemas/tutor-material.schema';
import {
  MaterialPurchase,
  MaterialPurchaseDocument,
} from './schemas/material-purchase.schema';
import { CreateTutorMaterialDto } from './dto/create-tutor-material.dto';
import { UpdateTutorMaterialDto } from './dto/update-tutor-material.dto';

@Injectable()
export class TutorMaterialsService {
  constructor(
    @InjectModel(TutorMaterial.name)
    private materialModel: Model<TutorMaterialDocument>,
    @InjectModel(MaterialPurchase.name)
    private purchaseModel: Model<MaterialPurchaseDocument>,
  ) {}

  async create(
    tutorId: string,
    dto: CreateTutorMaterialDto,
  ): Promise<TutorMaterial> {
    const material = new this.materialModel({
      ...dto,
      tutorId: new Types.ObjectId(tutorId),
    });
    return material.save();
  }

  async findAll(query: any = {}): Promise<TutorMaterial[]> {
    const filter: any = {};
    if (query.tutorId) {
      filter.tutorId = new Types.ObjectId(query.tutorId as string);
    }
    if (query.isActive !== undefined) {
      filter.isActive = String(query.isActive) === 'true';
    }

    return this.materialModel
      .find(filter)
      .populate('tutorId', 'firstName lastName avatar')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(id: string): Promise<TutorMaterial> {
    const material = await this.materialModel
      .findById(id)
      .populate('tutorId', 'firstName lastName avatar')
      .exec();
    if (!material) throw new NotFoundException(`Material not found`);
    return material;
  }

  async update(
    id: string,
    tutorId: string,
    dto: UpdateTutorMaterialDto,
  ): Promise<TutorMaterial> {
    const material = await this.materialModel.findOne({
      _id: new Types.ObjectId(id),
      tutorId: new Types.ObjectId(tutorId),
    });
    if (!material)
      throw new NotFoundException(
        'Material not found or you are not authorized to edit it',
      );

    Object.assign(material, dto);
    return material.save();
  }

  async remove(id: string, tutorId: string): Promise<void> {
    const result = await this.materialModel.deleteOne({
      _id: new Types.ObjectId(id),
      tutorId: new Types.ObjectId(tutorId),
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException(
        'Material not found or you are not authorized to delete it',
      );
    }
  }

  /** Has this student already paid for this material? Gates re-purchase and download. */
  async isPurchasedBy(studentId: string, materialId: string): Promise<boolean> {
    const existing = await this.purchaseModel.exists({
      studentId: new Types.ObjectId(studentId),
      materialId: new Types.ObjectId(materialId),
      status: 'paid',
    });
    return Boolean(existing);
  }

  /**
   * Grants a student access to a material after their payment settled.
   *
   * Called only from MaterialFulfilment. Idempotent: an upsert on
   * (studentId, materialId) means a redelivered webhook re-grants the same row
   * instead of creating a duplicate, and re-buying after a refund flips the
   * same row back to paid.
   */
  async grantPurchase(input: {
    studentId: string;
    materialId: string;
    amountPaidMinor: number;
    paymentId: string;
  }): Promise<void> {
    await this.purchaseModel.updateOne(
      {
        studentId: new Types.ObjectId(input.studentId),
        materialId: new Types.ObjectId(input.materialId),
      },
      {
        $set: {
          amountPaid: input.amountPaidMinor,
          paymentId: input.paymentId,
          status: 'paid',
        },
      },
      { upsert: true },
    );
  }

  /** Revokes a student's access when their payment is refunded. */
  async revokePurchase(studentId: string, materialId: string): Promise<void> {
    await this.purchaseModel.updateOne(
      {
        studentId: new Types.ObjectId(studentId),
        materialId: new Types.ObjectId(materialId),
      },
      { $set: { status: 'refunded' } },
    );
  }

  // Retrieve purchased materials for a student
  async getPurchasedMaterials(studentId: string): Promise<any[]> {
    const purchases = await this.purchaseModel
      .find({ studentId: new Types.ObjectId(studentId), status: 'paid' })
      .populate({
        path: 'materialId',
        populate: { path: 'tutorId', select: 'firstName lastName avatar' },
      })
      .exec();

    return purchases.map((p: any) => ({
      purchaseId: p._id,
      amountPaid: p.amountPaid,
      purchasedAt: p.createdAt,
      material: p.materialId,
    }));
  }
}
