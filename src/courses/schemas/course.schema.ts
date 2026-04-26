import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type CourseDocument = HydratedDocument<Course>;

@Schema({ timestamps: true })
export class Course extends Document {
  @ApiProperty({
    description: 'The instructor/tutor user who teaches this course',
  })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  instructorId: Types.ObjectId;

  @ApiProperty({ description: 'Name of the course' })
  @Prop({ required: true })
  title: string;

  @ApiProperty({ description: 'Price of the course' })
  @Prop({ required: true, default: 0 })
  price: number;

  @ApiProperty({ description: 'Average rating for this course' })
  @Prop({ default: 0 })
  averageRating: number;
}

export const CourseSchema = SchemaFactory.createForClass(Course);
CourseSchema.index({ instructorId: 1 });
