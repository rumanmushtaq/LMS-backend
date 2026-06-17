import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type ProductDocument = HydratedDocument<Product>;

@Schema({ timestamps: true })
export class Product {
  @ApiProperty({ description: 'Product title' })
  @Prop({ required: true, trim: true })
  title: string;

  @ApiProperty({ description: 'HTML description from rich-text editor' })
  @Prop({ required: true })
  description: string;

  @ApiProperty({ description: 'Price in USD' })
  @Prop({ required: true, min: 0 })
  price: number;

  @ApiProperty({ description: 'Array of ImageKit image URLs' })
  @Prop({ type: [String], default: [] })
  images: string[];

  @ApiProperty({ description: 'Available size variants e.g. S, M, L, XL' })
  @Prop({ type: [String], default: [] })
  sizes: string[];

  @ApiProperty({ description: 'Whether the product is live/active' })
  @Prop({ default: true })
  isActive: boolean;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
ProductSchema.index({ title: 'text', description: 'text' });
ProductSchema.index({ isActive: 1 });
ProductSchema.index({ createdAt: -1 });
