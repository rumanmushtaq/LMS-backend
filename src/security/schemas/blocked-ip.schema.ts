import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BlockedIpDocument = BlockedIp & Document;

export enum BlockType {
  MANUAL = 'manual',
  AUTO = 'auto',
}

@Schema({ timestamps: true })
export class BlockedIp {
  /**
   * What actually gets matched: an exact IPv4, an IPv6 /64, or an
   * admin-entered CIDR range. Produced by blockKeyForIp()/parseCidr() —
   * never a raw user string.
   */
  @Prop({ required: true, index: true })
  key: string;

  /** The literal address that triggered the block, kept for display. */
  @Prop({ required: true })
  sourceIp: string;

  @Prop({ required: true, enum: BlockType })
  type: BlockType;

  @Prop({ required: true })
  reason: string;

  /** Admin's ObjectId as a string, or the literal 'system' for auto-blocks. */
  @Prop({ required: true })
  blockedBy: string;

  /**
   * Mongo's TTL monitor deletes the document itself when this passes —
   * expiry needs no cron and cannot be forgotten. Null means permanent,
   * which only a human can set.
   */
  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const BlockedIpSchema = SchemaFactory.createForClass(BlockedIp);

BlockedIpSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } },
);
