import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import ImageKit, { toFile } from '@imagekit/nodejs';
import { Product, ProductDocument } from './schemas/product.schema';
import { CreateProductDto, GetProductsDto } from './dto';

@Injectable()
export class ProductsService {
  private imagekit: ImageKit;

  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    private configService: ConfigService,
  ) {
    this.imagekit = new ImageKit({
      privateKey: this.configService.get<string>('imagekit.privateKey')!,
    });
  }

  // ─── Upload helper ────────────────────────────────────────────────────────────
  private async uploadImages(files: Express.Multer.File[]): Promise<string[]> {
    const uploadPromises = files.map(async (file) => {
      const fileName = `${Date.now()}-${file.originalname}`;
      const result = await this.imagekit.files.upload({
        file: await toFile(file.buffer, fileName),
        fileName,
        folder: 'shop-products',
        publicKey: this.configService.get<string>('imagekit.publicKey')!,
      });
      return result.url!;
    });
    return Promise.all(uploadPromises);
  }

  // ─── Create ───────────────────────────────────────────────────────────────────
  async createProduct(
    dto: CreateProductDto,
    files: Express.Multer.File[] = [],
  ): Promise<ProductDocument> {
    const uploadedUrls = files.length > 0 ? await this.uploadImages(files) : [];
    const product = new this.productModel({
      ...dto,
      images: [...(dto.images ?? []), ...uploadedUrls],
      sizes: dto.sizes ?? [],
    });
    return product.save();
  }

  // ─── Update ───────────────────────────────────────────────────────────────────
  async updateProduct(
    id: string,
    dto: Partial<CreateProductDto>,
    files: Express.Multer.File[] = [],
  ): Promise<ProductDocument> {
    const product = await this.productModel.findById(id);
    if (!product) throw new NotFoundException(`Product ${id} not found`);

    const uploadedUrls = files.length > 0 ? await this.uploadImages(files) : [];

    const updateData: any = { ...dto };
    const currentImages = dto.images ?? product.images ?? [];
    updateData.images = [...currentImages, ...uploadedUrls];

    if (dto.sizes) updateData.sizes = dto.sizes;

    return this.productModel.findByIdAndUpdate(id, updateData, {
      new: true,
    }) as Promise<ProductDocument>;
  }

  // ─── Soft-delete (Deactivate) ─────────────────────────────────────────────────────────────
  async deactivateProduct(id: string): Promise<{ message: string }> {
    const product = await this.productModel.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return { message: 'Product deactivated successfully' };
  }

  // ─── Toggle Status ────────────────────────────────────────────────────────────────
  async toggleProductStatus(
    id: string,
    isActive: boolean,
  ): Promise<ProductDocument> {
    const product = await this.productModel.findByIdAndUpdate(
      id,
      { isActive },
      { new: true },
    );
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product as ProductDocument;
  }

  // ─── Permanent Delete ────────────────────────────────────────────────────────
  async permanentDeleteProduct(id: string): Promise<{ message: string }> {
    const product = await this.productModel.findByIdAndDelete(id);
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return { message: 'Product permanently deleted' };
  }

  // Keep deleteProduct for backward compatibility
  async deleteProduct(id: string): Promise<{ message: string }> {
    return this.deactivateProduct(id);
  }

  // ─── Get List ─────────────────────────────────────────────────────────────────
  async getProducts(
    query: GetProductsDto,
    onlyActive = true,
  ): Promise<{
    data: ProductDocument[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const skip = (page - 1) * limit;

    const filter: FilterQuery<ProductDocument> = {};

    // If isActive is explicitly provided in query, use it.
    // Otherwise fall back to onlyActive parameter.
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    } else if (onlyActive) {
      filter.isActive = true;
    }

    if (query.size) {
      filter.sizes = query.size;
    }

    if (query.search) {
      filter.$or = [
        { title: { $regex: query.search, $options: 'i' } },
        { description: { $regex: query.search, $options: 'i' } },
      ];
    }

    const [data, totalCount] = await Promise.all([
      this.productModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.productModel.countDocuments(filter),
    ]);

    return {
      data: data as ProductDocument[],
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
    };
  }

  // ─── Get by ID ────────────────────────────────────────────────────────────────
  async getProductById(id: string): Promise<ProductDocument> {
    const product = await this.productModel.findById(id).lean();
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product as ProductDocument;
  }
}
