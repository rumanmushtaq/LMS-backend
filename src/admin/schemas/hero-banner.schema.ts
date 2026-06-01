import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class HeroBanner extends Document {
  @Prop({ required: true })
  videoUrl: string;

  @Prop({ required: true, default: true })
  isActive: boolean;
}

export const HeroBannerSchema = SchemaFactory.createForClass(HeroBanner);
