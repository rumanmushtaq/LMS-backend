import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IpActivityDocument = IpActivity & Document;

/**
 * One document per IP per hour, updated with $inc/$addToSet from an
 * in-memory buffer — never one document per request, which at LMS traffic
 * levels would outgrow every other collection combined within weeks.
 *
 * IPs are personal data (GDPR): buckets self-delete via TTL after the
 * retention window instead of accumulating forever.
 */
@Schema()
export class IpActivity {
  @Prop({ required: true })
  ip: string;

  /** Start of the hour this bucket covers, UTC. */
  @Prop({ required: true })
  hour: Date;

  @Prop({ default: 0 })
  requests: number;

  @Prop({ default: 0 })
  failedLogins: number;

  /** Requests rejected (or, in shadow mode, that would have been) by a block. */
  @Prop({ default: 0 })
  blocked: number;

  /** Distinct account ids that authenticated successfully from this IP. */
  @Prop({ type: [String], default: [] })
  userIds: string[];

  @Prop()
  lastSeen: Date;
}

export const IpActivitySchema = SchemaFactory.createForClass(IpActivity);

IpActivitySchema.index({ ip: 1, hour: 1 }, { unique: true });
IpActivitySchema.index({ hour: 1 });

const RETENTION_DAYS = parseInt(
  process.env.SECURITY_ACTIVITY_RETENTION_DAYS || '90',
  10,
);
IpActivitySchema.index(
  { lastSeen: 1 },
  { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 },
);
