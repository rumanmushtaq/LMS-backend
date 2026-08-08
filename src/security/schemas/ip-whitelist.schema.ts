import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IpWhitelistDocument = IpWhitelist & Document;

/**
 * Whitelisted addresses are never blocked — checked before both the manual
 * and auto blocklists. This is the insurance against an admin (or a rule)
 * locking the team out of its own platform.
 */
@Schema({ timestamps: true })
export class IpWhitelist {
  /** Exact IP or CIDR range. */
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true })
  label: string;

  @Prop({ required: true })
  addedBy: string;

  createdAt?: Date;
}

export const IpWhitelistSchema = SchemaFactory.createForClass(IpWhitelist);
