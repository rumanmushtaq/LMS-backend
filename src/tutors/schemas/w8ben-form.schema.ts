// w8ben-form.schema.ts

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export type W8BENFormDocument = W8BENForm & Document;

@Schema({ timestamps: true })
export class W8BENForm {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  user: mongoose.Schema.Types.ObjectId;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ required: true })
  countryOfCitizenship: string;

  @Prop({ required: true })
  permanentResidenceAddress: string;

  @Prop()
  mailingAddress?: string;

  @Prop({ required: true })
  foreignTaxIdentifyingNumber: string;

  @Prop()
  usTin?: string;

  @Prop({ required: true })
  dateOfBirth: Date;

  @Prop({ required: true })
  treatyClaim: boolean;

  // Conditional treaty fields
  @Prop()
  treatyCountry?: string;

  @Prop()
  treatyArticle?: string;

  @Prop()
  withholdingRate?: string;

  @Prop({ required: true })
  certification: boolean;

  @Prop({ required: true })
  signature: string;

  @Prop({ required: true })
  signedAt: Date;
}

export const W8BENFormSchema = SchemaFactory.createForClass(W8BENForm);
