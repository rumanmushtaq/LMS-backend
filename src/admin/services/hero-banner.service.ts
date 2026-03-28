import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HeroBanner } from '../schemas/hero-banner.schema';
import {
  CreateHeroBannerDto,
  UpdateHeroBannerDto,
} from '../dto/hero-banner.dto';

@Injectable()
export class HeroBannerService {
  constructor(
    @InjectModel(HeroBanner.name) private heroBannerModel: Model<HeroBanner>,
  ) {}

  async create(createHeroBannerDto: CreateHeroBannerDto): Promise<HeroBanner> {
    const createdHeroBanner = new this.heroBannerModel(createHeroBannerDto);
    return createdHeroBanner.save();
  }

  async findAll(): Promise<HeroBanner[]> {
    return this.heroBannerModel.find().exec();
  }

  async findOne(id: string): Promise<HeroBanner> {
    const heroBanner = await this.heroBannerModel.findById(id).exec();
    if (!heroBanner) {
      throw new NotFoundException(`Hero Banner with ID ${id} not found`);
    }
    return heroBanner;
  }

  async update(
    id: string,
    updateHeroBannerDto: UpdateHeroBannerDto,
  ): Promise<HeroBanner> {
    const updatedHeroBanner = await this.heroBannerModel
      .findByIdAndUpdate(id, updateHeroBannerDto, { new: true })
      .exec();
    if (!updatedHeroBanner) {
      throw new NotFoundException(`Hero Banner with ID ${id} not found`);
    }
    return updatedHeroBanner;
  }

  async remove(id: string): Promise<void> {
    const result = await this.heroBannerModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Hero Banner with ID ${id} not found`);
    }
  }
}
