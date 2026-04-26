import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type CertificateDocument = HydratedDocument<Certificate>;

@Schema({ timestamps: true })
export class Certificate extends Document {
  @ApiProperty({ description: 'The student ID who earned the certificate' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @ApiProperty({ description: 'Name of the course' })
  @Prop({ required: true })
  courseName: string;

  @ApiProperty({ description: 'Date the certificate was issued' })
  @Prop({ required: true })
  date: Date;

  @ApiProperty({ description: 'Marks obtained by the student' })
  @Prop({ required: true })
  marks: number;

  @ApiProperty({ description: 'Total possible marks' })
  @Prop({ required: true })
  outOf: number;

  @ApiProperty({ description: 'URL to download the certificate PDF' })
  @Prop({ required: true })
  downloadUrl: string;
}

export const CertificateSchema = SchemaFactory.createForClass(Certificate);
CertificateSchema.index({ studentId: 1, date: -1 });
