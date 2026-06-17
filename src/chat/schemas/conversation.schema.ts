import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({ timestamps: true })
export class Conversation extends Document {
  @ApiProperty({ description: 'Participants in the conversation' })
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], required: true })
  participants: Types.ObjectId[];

  @ApiProperty({ description: 'Is the conversation blocked?' })
  @Prop({ type: Boolean, default: false })
  isBlocked: boolean;

  @ApiProperty({ description: 'The user who blocked the conversation' })
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  blockedBy: Types.ObjectId | null;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ participants: 1 });
