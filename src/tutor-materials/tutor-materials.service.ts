import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TutorMaterial, TutorMaterialDocument } from './schemas/tutor-material.schema';
import { MaterialPurchase, MaterialPurchaseDocument } from './schemas/material-purchase.schema';
import { CreateTutorMaterialDto } from './dto/create-tutor-material.dto';
import { UpdateTutorMaterialDto } from './dto/update-tutor-material.dto';

@Injectable()
export class TutorMaterialsService {
  constructor(
    @InjectModel(TutorMaterial.name) private materialModel: Model<TutorMaterialDocument>,
    @InjectModel(MaterialPurchase.name) private purchaseModel: Model<MaterialPurchaseDocument>,
  ) {}

  async create(tutorId: string, dto: CreateTutorMaterialDto): Promise<TutorMaterial> {
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

    return this.materialModel.find(filter).populate('tutorId', 'firstName lastName avatar').sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string): Promise<TutorMaterial> {
    const material = await this.materialModel.findById(id).populate('tutorId', 'firstName lastName avatar').exec();
    if (!material) throw new NotFoundException(`Material not found`);
    return material;
  }

  async update(id: string, tutorId: string, dto: UpdateTutorMaterialDto): Promise<TutorMaterial> {
    const material = await this.materialModel.findOne({ _id: new Types.ObjectId(id), tutorId: new Types.ObjectId(tutorId) });
    if (!material) throw new NotFoundException('Material not found or you are not authorized to edit it');

    Object.assign(material, dto);
    return material.save();
  }

  async remove(id: string, tutorId: string): Promise<void> {
    const result = await this.materialModel.deleteOne({ _id: new Types.ObjectId(id), tutorId: new Types.ObjectId(tutorId) });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Material not found or you are not authorized to delete it');
    }
  }

  // MVP Mock Purchase logic
  async purchaseMaterial(studentId: string, materialId: string): Promise<any> {
    const material = await this.materialModel.findById(materialId);
    if (!material) throw new NotFoundException('Material not found');
    if (!material.isActive) throw new BadRequestException('Material is not available for purchase');

    // Check if already purchased
    const existing = await this.purchaseModel.findOne({
      studentId: new Types.ObjectId(studentId),
      materialId: new Types.ObjectId(materialId),
      status: 'paid'
    });

    if (existing) {
      return { message: 'Already purchased', downloadUrl: material.fileUrl };
    }

    // Create a mock purchase record
    const mockIntentId = 'pi_mock_' + Math.random().toString(36).substring(2, 15);
    const purchase = new this.purchaseModel({
      studentId: new Types.ObjectId(studentId),
      materialId: new Types.ObjectId(materialId),
      amountPaid: material.price,
      stripePaymentIntentId: mockIntentId,
      status: 'paid', // Mocking instant payment success
    });

    await purchase.save();

    return {
      message: 'Purchase successful',
      purchaseId: purchase._id,
      downloadUrl: material.fileUrl,
    };
  }

  // Retrieve purchased materials for a student
  async getPurchasedMaterials(studentId: string): Promise<any[]> {
    const purchases = await this.purchaseModel
      .find({ studentId: new Types.ObjectId(studentId), status: 'paid' })
      .populate({
        path: 'materialId',
        populate: { path: 'tutorId', select: 'firstName lastName avatar' }
      })
      .exec();
    
    return purchases.map((p: any) => ({
      purchaseId: p._id,
      amountPaid: p.amountPaid,
      purchasedAt: p.createdAt,
      material: p.materialId
    }));
  }
}
