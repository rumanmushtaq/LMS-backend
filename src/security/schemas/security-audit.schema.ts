import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SecurityAuditDocument = SecurityAudit & Document;

export enum SecurityAuditAction {
  BLOCK = 'block',
  UNBLOCK = 'unblock',
  AUTO_BLOCK = 'auto_block',
  WHITELIST_ADD = 'whitelist_add',
  WHITELIST_REMOVE = 'whitelist_remove',
}

/**
 * Append-only by construction: no update or delete path exists anywhere in
 * the codebase. When a paying user asks "why was I blocked?", the incident
 * id on their 403 resolves to exactly one of these records.
 */
@Schema({ timestamps: true })
export class SecurityAudit {
  @Prop({ required: true, enum: SecurityAuditAction })
  action: SecurityAuditAction;

  @Prop({ required: true, index: true })
  key: string;

  @Prop({ required: true })
  reason: string;

  /** Admin's ObjectId as a string, or 'system'. */
  @Prop({ required: true })
  actor: string;

  /** Human-readable actor name resolved at write time (admins change; the log must not). */
  @Prop({ default: 'System' })
  actorName: string;

  @Prop({ type: Object, default: null })
  detail: Record<string, unknown> | null;

  createdAt?: Date;
}

export const SecurityAuditSchema = SchemaFactory.createForClass(SecurityAudit);

const AUDIT_RETENTION_DAYS = 365;
SecurityAuditSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: AUDIT_RETENTION_DAYS * 24 * 60 * 60 },
);
