import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

import * as mongoose from 'mongoose';

export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({ timestamps: true })
export class Conversation extends Document {
  @ApiProperty({ description: 'Participants in the conversation' })
  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    required: true,
  })
  participants: mongoose.Types.ObjectId[];

  @ApiProperty({ description: 'Is the conversation blocked?' })
  @Prop({ type: Boolean, default: false })
  isBlocked: boolean;

  @ApiProperty({ description: 'The user who blocked the conversation' })
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  blockedBy: Types.ObjectId | null;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ participants: 1 });
