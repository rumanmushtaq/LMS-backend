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

  /**
   * What kind of thread this is.
   *
   * A class Q&A room holds the tutor and that class's students, which on a
   * one-to-one class is the same two people as their private chat — identical
   * in shape, so nothing but this field can tell them apart. Documents written
   * before this existed have no `type`; they are all private chats, so every
   * query treats "missing" as 'dm' rather than filtering them away.
   */
  @ApiProperty({ description: "'dm' (private chat) or 'class' (Q&A room)" })
  @Prop({ type: String, enum: ['dm', 'class'], default: 'dm' })
  type: 'dm' | 'class';

  @ApiProperty({ description: 'The class a Q&A room belongs to' })
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'ClassSession', default: null })
  classId: mongoose.Types.ObjectId | null;

  @ApiProperty({ description: 'Is the conversation blocked?' })
  @Prop({ type: Boolean, default: false })
  isBlocked: boolean;

  @ApiProperty({ description: 'The user who blocked the conversation' })
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  blockedBy: Types.ObjectId | null;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ participants: 1 });
// The chat list and the DM lookup both filter on kind.
ConversationSchema.index({ participants: 1, type: 1 });
