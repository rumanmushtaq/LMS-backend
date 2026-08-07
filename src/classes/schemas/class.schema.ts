import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export enum ClassStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  SCHEDULED = 'SCHEDULED',
  ONGOING = 'ONGOING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/** State of the Vimeo live broadcast attached to a class session. */
export enum LiveStatus {
  IDLE = 'idle', // Vimeo event created but not broadcasting yet
  LIVE = 'live', // tutor is currently broadcasting
  ENDED = 'ended', // broadcast finished
}

/**
 * Vimeo Live broadcast metadata for a class session.
 * `rtmpUrl` and `streamKey` are broadcaster secrets — they are stripped from
 * every serialized response (see toJSON below) and only handed to the tutor
 * through the dedicated `/live/broadcast` endpoint.
 */
@Schema({ _id: false })
export class LiveSession {
  @Prop({ type: String, default: null })
  vimeoEventId: string | null;

  @Prop({ type: String, default: null })
  rtmpUrl: string | null; // SECRET — tutor only

  @Prop({ type: String, default: null })
  streamKey: string | null; // SECRET — tutor only

  @Prop({ type: String, default: null })
  embedUrl: string | null; // safe to expose to enrolled students

  @Prop({ type: String, enum: LiveStatus, default: LiveStatus.IDLE })
  status: LiveStatus;

  @Prop({ type: Types.ObjectId, ref: 'Conversation', default: null })
  conversationId: Types.ObjectId | null; // shared Q&A chat room

  @Prop({ type: String, default: null })
  recordingUrl: string | null;

  @Prop({ type: Date, default: null })
  startedAt: Date | null;

  @Prop({ type: Date, default: null })
  endedAt: Date | null;
}

export const LiveSessionSchema = SchemaFactory.createForClass(LiveSession);

export type ClassSessionDocument = HydratedDocument<ClassSession>;

@Schema({ timestamps: true })
export class ClassSession extends Document {
  @ApiProperty({ description: 'The instructor/tutor user who teaches this class' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  tutorId: Types.ObjectId;

  @ApiProperty({ description: 'The student who requested this class session' })
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  requestedBy: Types.ObjectId | null;

  @ApiProperty({ description: 'Title of the class session' })
  @Prop({ required: true })
  title: string;

  @ApiProperty({ description: 'Detailed description of the class session' })
  @Prop({ required: true })
  description: string;

  @ApiProperty({ description: 'Students enrolled in the class' })
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  students: Types.ObjectId[];

  @ApiProperty({ description: 'Optional reference to a parent Course' })
  @Prop({ type: Types.ObjectId, ref: 'Course', default: null })
  courseId: Types.ObjectId | null;

  @ApiProperty({ description: 'Meeting link (e.g. Zoom, Google Meet)' })
  @Prop({ required: false, default: null })
  meetingLink: string;

  @ApiProperty({ description: 'Start time of the class' })
  @Prop({ type: Date, required: true })
  startTime: Date;

  @ApiProperty({ description: 'End time of the class' })
  @Prop({ type: Date, required: true })
  endTime: Date;

  @ApiProperty({ description: 'Status of the class', enum: ClassStatus })
  @Prop({ type: String, enum: ClassStatus, default: ClassStatus.PENDING_APPROVAL })
  status: ClassStatus;

  @ApiProperty({ description: 'Reason provided when a tutor declines a class request' })
  @Prop({ type: String, default: null })
  declineReason: string | null;

  @ApiProperty({ description: 'Vimeo live-broadcast metadata for this class' })
  @Prop({ type: LiveSessionSchema, default: () => ({}) })
  liveSession: LiveSession;
}

export const ClassSessionSchema = SchemaFactory.createForClass(ClassSession);
ClassSessionSchema.index({ tutorId: 1 });
ClassSessionSchema.index({ requestedBy: 1 });
ClassSessionSchema.index({ startTime: 1 });
ClassSessionSchema.index({ status: 1 });

// Never leak broadcaster secrets in any serialized class payload. The RTMP
// ingest URL and stream key are delivered only via the tutor-only
// GET /classes/:id/live/broadcast endpoint.
ClassSessionSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    if (ret.liveSession) {
      delete ret.liveSession.rtmpUrl;
      delete ret.liveSession.streamKey;
    }
    return ret;
  },
});
