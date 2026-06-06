import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import ImageKit, { toFile } from '@imagekit/nodejs';
import { Category, CategoryDocument } from './schemas/category.schema';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  private imagekit: ImageKit;

  constructor(
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    private configService: ConfigService,
  ) {
    this.imagekit = new ImageKit({
      privateKey: this.configService.get<string>('imagekit.privateKey')!,
    });
  }

  private async uploadImage(file: Express.Multer.File): Promise<string> {
    const fileName = `${Date.now()}-${file.originalname}`;
    const result = await this.imagekit.files.upload({
      file: await toFile(file.buffer, fileName),
      fileName,
      folder: 'categories',
      publicKey: this.configService.get<string>('imagekit.publicKey')!,
    });
    return result.url!;
  }

  async create(
    dto: CreateCategoryDto,
    file?: Express.Multer.File,
  ): Promise<CategoryDocument> {
    let imageUrl = '';
    if (file) {
      imageUrl = await this.uploadImage(file);
    }
    const category = new this.categoryModel({
      ...dto,
      image: imageUrl,
      isActive:
        dto.isActive !== undefined ? String(dto.isActive) === 'true' : true,
    });
    return category.save();
  }

  async findAll(): Promise<CategoryDocument[]> {
    return this.categoryModel.find().sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string): Promise<CategoryDocument> {
    const category = await this.categoryModel.findById(id).exec();
    if (!category) throw new NotFoundException(`Category ${id} not found`);
    return category;
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
    file?: Express.Multer.File,
  ): Promise<CategoryDocument> {
    const category = await this.categoryModel.findById(id);
    if (!category) throw new NotFoundException(`Category ${id} not found`);

    const updateData: any = { ...dto };
    if (file) {
      updateData.image = await this.uploadImage(file);
    }

    if (dto.isActive !== undefined) {
      updateData.isActive = String(dto.isActive) === 'true';
    }

    return this.categoryModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .exec() as Promise<CategoryDocument>;
  }

  async remove(id: string): Promise<{ message: string }> {
    const result = await this.categoryModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException(`Category ${id} not found`);
    return { message: 'Category deleted successfully' };
  }
}
