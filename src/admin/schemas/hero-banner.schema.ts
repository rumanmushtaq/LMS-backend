import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class HeroBanner extends Document {
  @Prop({ required: true, default: 'The Leader in Online Learning' })
  subtitle: string;

  @Prop({
    required: true,
    default: 'Engaging & Accessible Online Courses For All',
  })
  title: string;

  @Prop({
    required: true,
    default:
      'Our specialized online courses are designed to bring the classroom experience to you, no matter where you are.',
  })
  description: string;

  @Prop({ required: true, default: '/images/hero-banner.jpg' })
  imageUrl: string;

  @Prop({
    required: true,
    default: 'Trusted by over 15K Users worldwide since 2022',
  })
  trustedText: string;

  @Prop({ required: true, default: '1000+' })
  studentCount: string;

  @Prop({ required: true, default: '50+' })
  courseCount: string;

  @Prop({ required: true, default: '4.8' })
  rating: string;

  @Prop({ required: false, default: 'Online' })
  highlightedWord: string;
}

export const HeroBannerSchema = SchemaFactory.createForClass(HeroBanner);
