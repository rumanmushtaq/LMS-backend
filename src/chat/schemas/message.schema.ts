import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

import * as mongoose from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

@Schema({ _id: false })
export class MessageAttachment {
  @ApiProperty({ description: 'Public storage URL of the file' })
  @Prop({ type: String, required: true })
  url: string;

  @ApiProperty({ description: 'Original filename, as the sender saw it' })
  @Prop({ type: String, required: true })
  name: string;

  @ApiProperty({ description: 'MIME type, from our allowlist' })
  @Prop({ type: String, required: true })
  mimeType: string;

  @ApiProperty({ description: 'Size in bytes' })
  @Prop({ type: Number, required: true })
  size: number;
}

export const MessageAttachmentSchema =
  SchemaFactory.createForClass(MessageAttachment);

@Schema({ timestamps: true })
export class Message extends Document {
  @ApiProperty({ description: 'The conversation this message belongs to' })
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  })
  conversationId: mongoose.Types.ObjectId;

  @ApiProperty({ description: 'The sender of the message' })
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  senderId: mongoose.Types.ObjectId;

  @ApiProperty({ description: 'The content of the message' })
  // Not required: a message carrying only a file has no caption to store.
  @Prop({ type: String, default: '' })
  content: string;

  @ApiProperty({ description: 'A file sent with this message, if any' })
  @Prop({ type: MessageAttachmentSchema, default: null })
  attachment: MessageAttachment | null;

  @ApiProperty({ description: 'Is the message read by the recipient?' })
  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  @ApiProperty({ description: 'Is the message flagged?' })
  @Prop({ type: Boolean, default: false })
  isFlagged: boolean;

  @ApiProperty({ description: 'Reason for flagging, if any' })
  @Prop({ type: String, default: null })
  flagReason: string | null;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: 1 });
// Backs the per-conversation unread tally on the conversations list.
MessageSchema.index({ conversationId: 1, isRead: 1, senderId: 1 });
