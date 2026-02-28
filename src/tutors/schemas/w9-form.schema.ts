// w9-form.schema.ts

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export type W9FormDocument = W9Form & Document;

export enum FederalTaxClassification {
  INDIVIDUAL = 'individual',
  LLC = 'llc',
  CORPORATION = 'corporation',
  S_CORPORATION = 's_corporation',
  PARTNERSHIP = 'partnership',
  TRUST_ESTATE = 'trust_estate',
  OTHER = 'other',
}

export enum TinType {
  SSN = 'SSN',
  EIN = 'EIN',
}

@Schema({ timestamps: true })
export class W9Form {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  user: mongoose.Schema.Types.ObjectId;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ trim: true })
  businessName?: string;

  @Prop({ required: true, enum: FederalTaxClassification })
  federalTaxClassification: FederalTaxClassification;

  @Prop()
  exemptions?: string;

  @Prop({ required: true })
  address: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  state: string;

  @Prop({ required: true })
  zipCode: string;

  @Prop({ required: true, default: 'US' })
  country: string;

  @Prop({ required: true, enum: TinType })
  tinType: TinType;

  @Prop({ required: true })
  tinNumber: string;

  @Prop({ required: true })
  certification: boolean;

  @Prop({ required: true })
  signature: string;

  @Prop({ required: true })
  signedAt: Date;
}

export const W9FormSchema = SchemaFactory.createForClass(W9Form);
