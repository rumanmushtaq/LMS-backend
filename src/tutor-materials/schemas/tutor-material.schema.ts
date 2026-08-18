import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type TutorMaterialDocument = HydratedDocument<TutorMaterial>;

@Schema({ timestamps: true })
export class TutorMaterial {
  @ApiProperty({ description: 'The tutor who uploaded this material' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  tutorId: Types.ObjectId;

  @ApiProperty({ description: 'Title of the book or notes' })
  @Prop({ required: true, trim: true })
  title: string;

  @ApiProperty({ description: 'Description of the material' })
  @Prop({ required: true })
  description: string;

  @ApiProperty({ description: 'Price in USD cents' })
  @Prop({ required: true, min: 0 })
  price: number;

  @ApiProperty({ description: 'Storage URL of the uploaded material file' })
  @Prop({ required: true })
  fileUrl: string;

  @ApiProperty({ description: 'Storage URL of the optional cover image' })
  @Prop({ type: String, default: null })
  coverImageUrl: string | null;

  @ApiProperty({
    description: 'Whether the material is active and available for purchase',
  })
  @Prop({ default: true })
  isActive: boolean;
}

export const TutorMaterialSchema = SchemaFactory.createForClass(TutorMaterial);
TutorMaterialSchema.index({ tutorId: 1 });
TutorMaterialSchema.index({ isActive: 1 });
TutorMaterialSchema.index({ createdAt: -1 });
