import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type SessionDocument = HydratedDocument<Session>;

/**
 * Server-side session record — the authority on whether a login is still alive.
 *
 * Access tokens are stateless and cannot be revoked once signed, so the idle
 * timeout cannot live in the JWT. Every authenticated request and every refresh
 * resolves the `sid` claim to one of these documents and re-checks it. A token
 * that is cryptographically valid still fails if its session is idle, revoked
 * or past its absolute lifetime.
 *
 * One document per login (per device), rather than one field per user, so
 * signing out on a phone does not sign the same account out on a laptop.
 */
@Schema({ timestamps: true })
export class Session {
  @ApiProperty({ description: 'The user this session belongs to' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @ApiProperty({
    description: 'Hash of the current refresh token for this session',
  })
  @Prop({ type: String, default: null })
  refreshTokenHash: string | null;

  @ApiProperty({
    description: 'Last time the user performed meaningful activity',
  })
  @Prop({ type: Date, required: true })
  lastActivityAt: Date;

  @ApiProperty({
    description: 'Hard ceiling on session lifetime, regardless of activity',
  })
  @Prop({ type: Date, required: true })
  absoluteExpiresAt: Date;

  @ApiProperty({ description: 'When the session was revoked, if it has been' })
  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  @ApiProperty({
    description: 'Why the session ended — for audit and debugging',
  })
  @Prop({
    type: String,
    enum: [
      'logout',
      'idle_timeout',
      'absolute_timeout',
      'reuse_detected',
      'password_change',
    ],
    default: null,
  })
  revokedReason: string | null;

  @ApiProperty({ description: 'User agent captured at login' })
  @Prop({ type: String, default: null })
  userAgent: string | null;

  @ApiProperty({ description: 'IP address captured at login' })
  @Prop({ type: String, default: null })
  ipAddress: string | null;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

// Looking up every live session for a user drives logout-everywhere and
// reuse-detection revocation.
SessionSchema.index({ userId: 1, revokedAt: 1 });

// Mongo removes the document once the absolute lifetime passes. This is only
// housekeeping — expiry is still enforced in code, because TTL eviction runs on
// a background sweep roughly every 60s and must never be the security boundary.
SessionSchema.index({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 0 });

// The refresh-token hash must never leave the server.
SessionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete (ret as unknown as Record<string, unknown>).refreshTokenHash;
    return ret;
  },
});
