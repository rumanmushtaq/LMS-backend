import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type OrderDocument = HydratedDocument<Order>;

@Schema({ timestamps: true })
export class Order extends Document {
  @ApiProperty({ description: 'The student ID who bought the course' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @ApiProperty({ description: 'The instructor ID whose course was bought' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  instructorId: Types.ObjectId;

  @ApiProperty({ description: 'The course ID that was bought' })
  @Prop({ type: Types.ObjectId, ref: 'Course', required: true })
  courseId: Types.ObjectId;

  @ApiProperty({ description: 'The total amount paid' })
  @Prop({ required: true })
  amountPaid: number;

  @ApiProperty({ description: 'Date the order was placed' })
  @Prop({ default: Date.now })
  orderDate: Date;

  @ApiProperty({ description: 'Status of the order' })
  @Prop({ default: 'completed' })
  status: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ studentId: 1 });
OrderSchema.index({ instructorId: 1 });
OrderSchema.index({ courseId: 1 });
OrderSchema.index({ orderDate: -1 });
