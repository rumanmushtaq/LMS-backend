import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument, Types } from 'mongoose';
import {
  LiveSession,
  LiveSessionSchema,
  LiveStatus,
} from '../../classes/schemas/class.schema';

export type TeacherStreamDocument = HydratedDocument<TeacherStream>;

/**
 * A teacher's open "go live" broadcast: like a live class, but with no
 * schedule, no roster and no price. Any student may join while it is live.
 *
 * Deliberately its own collection rather than a ClassSession variant: classes
 * feed dashboards, payouts, the missed/start sweeps and the cancellation
 * 3-strike rule, none of which should ever count a stream. The broadcast
 * itself reuses the class machinery as-is: the same `liveSession`
 * sub-document, providers, ingest relay, HLS gate and Q&A chat.
 */
@Schema({ timestamps: true })
export class TeacherStream {
  // mongoose's own ObjectId type (not the BSON class) so string ids cast.
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  tutorId: Types.ObjectId;

  @Prop({ type: String, default: '' })
  title: string;

  /** Mirrors liveSession.status; top-level so the indexes can use it. */
  @Prop({ type: String, enum: LiveStatus, default: LiveStatus.IDLE })
  status: LiveStatus;

  /**
   * True until the stream ends. The unique partial index below keys on it,
   * which is what makes "one stream per teacher at a time" a database rule
   * rather than a check two concurrent clicks could both pass.
   */
  @Prop({ type: Boolean, default: true })
  active: boolean;

  @Prop({ type: LiveSessionSchema, default: () => ({}) })
  liveSession: LiveSession;

  /** Students who opened the stream — for the admin view and the Q&A room. */
  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] })
  viewers: Types.ObjectId[];

  @Prop({ type: Date, default: null })
  startedAt: Date | null;

  @Prop({ type: Date, default: null })
  endedAt: Date | null;

  @Prop({ type: String, enum: ['tutor', 'admin', 'system', null], default: null })
  endedBy: 'tutor' | 'admin' | 'system' | null;

  /** Set once students were told the teacher is live; a resume must not re-alert. */
  @Prop({ type: Date, default: null })
  notifiedAt: Date | null;

  /**
   * Last time the browser relay saw video for this stream (throttled). A live
   * stream whose camera stopped feeding — tab closed, laptop asleep — is ended
   * by the sweep once this goes stale, so cards never show a dead LIVE badge.
   */
  @Prop({ type: Date, default: null })
  broadcastSeenAt: Date | null;
}

export const TeacherStreamSchema = SchemaFactory.createForClass(TeacherStream);

TeacherStreamSchema.index(
  { tutorId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
TeacherStreamSchema.index({ status: 1, startedAt: -1 });
TeacherStreamSchema.index({ createdAt: -1 });

// Same rule as classes: broadcaster secrets never leave through a serializer.
TeacherStreamSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    if (ret.liveSession) {
      delete ret.liveSession.rtmpUrl;
      delete ret.liveSession.streamKey;
    }
    return ret;
  },
});
