import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatService } from '../chat/chat.service';
import {
  ClassSession,
  ClassSessionDocument,
  LiveStatus,
} from '../classes/schemas/class.schema';
import { LiveStreamingService } from '../live/live-streaming.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserRole } from '../users/schemas/user.schema';
import {
  TeacherStream,
  TeacherStreamDocument,
} from './schemas/teacher-stream.schema';

/** How long a live stream may go without camera video before the sweep ends it. */
export const STALE_BROADCAST_MS = 3 * 60 * 1000;

/** A stream set up but never taken live is abandoned after this long. */
export const ABANDONED_IDLE_MS = 2 * 60 * 60 * 1000;

const STREAM_SWEEP_INTERVAL_MS = 60 * 1000;

export const STUDENTS_ONLY_MESSAGE =
  "Only students can join a teacher's live stream";

const idOf = (value: any): string =>
  value && typeof value === 'object' && value._id
    ? String(value._id)
    : String(value ?? '');

export interface StreamActor {
  userId: string;
  role: string;
}

/** What the ingest relay needs to broadcast into a stream. */
export interface StreamBroadcastTarget {
  tutorId: string;
  liveSession: any;
  active: boolean;
}

@Injectable()
export class TeacherStreamsService {
  private readonly logger = new Logger(TeacherStreamsService.name);

  constructor(
    @InjectModel(TeacherStream.name)
    private readonly streamModel: Model<TeacherStreamDocument>,
    @InjectModel(ClassSession.name)
    private readonly classModel: Model<ClassSessionDocument>,
    private readonly liveStreaming: LiveStreamingService,
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Teacher ────────────────────────────────────────────────────────────

  /**
   * Open (or reopen) the teacher's stream: provisions the broadcast and the
   * Q&A room once, then returns the broadcaster view. Calling it again while a
   * stream is active returns that same stream — a refresh or a second tab
   * never creates a parallel one.
   */
  async startOrResume(tutorId: string, title?: string) {
    const existing = await this.findActiveFor(tutorId);
    if (existing) return this.broadcastPayload(existing);

    const cleanTitle = title?.trim() || 'Live stream';
    const event = await this.liveStreaming.provision(cleanTitle);

    let stream: TeacherStreamDocument;
    try {
      stream = await this.streamModel.create({
        tutorId: new Types.ObjectId(tutorId),
        title: cleanTitle,
        status: LiveStatus.IDLE,
        active: true,
        liveSession: { ...event, status: LiveStatus.IDLE },
      });
    } catch (err: any) {
      // Two concurrent "Go live" clicks: the unique index let one through.
      // Release what this loser provisioned and hand back the winner.
      if (err?.code === 11000) {
        await this.liveStreaming.teardown(event);
        const winner = await this.findActiveFor(tutorId);
        if (winner) return this.broadcastPayload(winner);
      }
      throw err;
    }

    const convo = await this.chatService.createClassConversation(
      [tutorId],
      stream._id.toString(),
    );
    stream.liveSession.conversationId = convo._id as Types.ObjectId;
    await stream.save();

    return this.broadcastPayload(stream);
  }

  /** The teacher's active stream (with broadcaster credentials), or null. */
  async getMine(tutorId: string) {
    const stream = await this.findActiveFor(tutorId);
    return stream ? this.broadcastPayload(stream) : null;
  }

  /**
   * Video is flowing: flip the stream live so cards show it, and tell the
   * teacher's students once. Resuming after a dropped camera is allowed and
   * does not re-notify.
   */
  async goLive(streamId: string, tutorId: string) {
    const stream = await this.findById(streamId);
    this.assertOwner(stream, tutorId);
    if (!stream.active) {
      throw new BadRequestException('This stream has ended. Start a new one.');
    }

    const now = new Date();
    stream.status = LiveStatus.LIVE;
    stream.liveSession.status = LiveStatus.LIVE;
    stream.startedAt = stream.startedAt ?? now;
    stream.liveSession.startedAt = stream.liveSession.startedAt ?? now;
    stream.broadcastSeenAt = now;
    const shouldNotify = !stream.notifiedAt;
    if (shouldNotify) stream.notifiedAt = now;
    await stream.save();

    this.emitStatus(stream);
    if (shouldNotify) await this.notifyStudents(stream);

    return this.watchSummary(stream);
  }

  /** The teacher (or an admin) ends the stream. Ending twice is harmless. */
  async end(streamId: string, actor: StreamActor) {
    const stream = await this.findById(streamId);
    const isAdmin = actor.role === UserRole.ADMIN;
    if (!isAdmin) this.assertOwner(stream, actor.userId);
    if (!stream.active) return this.watchSummary(stream);

    await this.finish(stream, isAdmin ? 'admin' : 'tutor');
    return this.watchSummary(stream);
  }

  // ─── Students ───────────────────────────────────────────────────────────

  /** Teachers live right now — what the instructor cards light up from. */
  async listLive() {
    const streams = await this.streamModel
      .find({ active: true, status: LiveStatus.LIVE })
      .select('tutorId title startedAt')
      .sort({ startedAt: -1 })
      .lean()
      .exec();
    return streams.map((s) => ({
      streamId: String(s._id),
      tutorId: String(s.tutorId),
      title: s.title,
      startedAt: s.startedAt,
    }));
  }

  /**
   * The watch page's view of a stream. Only students may join: a teacher must
   * not sit in another teacher's stream, and admins moderate from the admin
   * app (where they can end a stream) rather than by watching it.
   */
  async getWatchInfo(streamId: string, actor: StreamActor) {
    if (actor.role !== UserRole.STUDENT) {
      throw new ForbiddenException(STUDENTS_ONLY_MESSAGE);
    }
    const stream = await this.findById(streamId, true);
    const live = stream.liveSession;

    if (stream.active) {
      await this.streamModel.updateOne(
        { _id: stream._id },
        { $addToSet: { viewers: new Types.ObjectId(actor.userId) } },
      );
      if (live?.conversationId) {
        await this.chatService.addParticipant(
          live.conversationId.toString(),
          actor.userId,
        );
      }
    }

    const tutor: any = stream.tutorId;
    return {
      streamId: stream._id.toString(),
      title: stream.title,
      status: stream.status,
      startedAt: stream.startedAt,
      tutor: {
        _id: idOf(tutor),
        name: `${tutor?.firstName ?? ''} ${tutor?.lastName ?? ''}`.trim(),
      },
      live: {
        status: stream.status,
        provider: this.liveStreaming.providerOf(live),
        embedUrl: stream.active ? (live?.embedUrl ?? null) : null,
        conversationId: live?.conversationId?.toString() ?? null,
      },
    };
  }

  // ─── Admin ──────────────────────────────────────────────────────────────

  async listForAdmin(status?: string) {
    const filter: Record<string, unknown> = {};
    if (status === 'live') filter.active = true;
    if (status === 'ended') filter.active = false;
    const streams = await this.streamModel
      .find(filter)
      .populate('tutorId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()
      .exec();
    return streams.map((s: any) => ({
      _id: String(s._id),
      title: s.title,
      status: s.status,
      active: s.active,
      tutor: s.tutorId
        ? {
            _id: idOf(s.tutorId),
            name: `${s.tutorId.firstName ?? ''} ${s.tutorId.lastName ?? ''}`.trim(),
            email: s.tutorId.email ?? null,
          }
        : null,
      viewerCount: (s.viewers ?? []).length,
      provider: s.liveSession?.provider ?? null,
      createdAt: s.createdAt,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      endedBy: s.endedBy,
    }));
  }

  // ─── Broadcast plumbing (ingest relay + HLS gate) ───────────────────────

  /** The stream behind an id, or null when the id is not a stream (a class). */
  async findBroadcastTarget(id: string): Promise<StreamBroadcastTarget | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const stream = await this.streamModel
      .findById(id)
      .select('tutorId liveSession active')
      .lean()
      .exec();
    if (!stream) return null;
    return {
      tutorId: String(stream.tutorId),
      liveSession: stream.liveSession,
      active: stream.active,
    };
  }

  /**
   * HLS playback rule for a stream: any student while it is active, plus the
   * teacher on their own stream. Never another teacher, never an admin.
   */
  mayWatch(target: StreamBroadcastTarget, userId: string, role: string): boolean {
    if (!target.active) return false;
    if (role === UserRole.STUDENT) return true;
    return role === UserRole.TUTOR && target.tutorId === userId;
  }

  /** The relay saw video; keeps the stream out of the stale sweep. */
  async heartbeat(streamId: string): Promise<void> {
    await this.streamModel.updateOne(
      { _id: new Types.ObjectId(streamId), active: true },
      { $set: { broadcastSeenAt: new Date() } },
    );
  }

  // ─── Sweep ──────────────────────────────────────────────────────────────

  @Interval('teacher-stream-sweep', STREAM_SWEEP_INTERVAL_MS)
  async handleSweep(): Promise<void> {
    try {
      const ended = await this.sweepStaleStreams();
      if (ended > 0) this.logger.log(`Stream sweep: ended ${ended} stream(s)`);
    } catch (err: any) {
      this.logger.error(`Stream sweep failed: ${err?.message}`);
    }
  }

  /**
   * End streams nobody is broadcasting into any more. Only self-hosted
   * streams carry a heartbeat (the relay is ours); an OBS stream on Vimeo or
   * YouTube is left to its teacher, bar the abandoned-setup rule.
   */
  async sweepStaleStreams(now = new Date()): Promise<number> {
    const staleBefore = new Date(now.getTime() - STALE_BROADCAST_MS);
    const abandonedBefore = new Date(now.getTime() - ABANDONED_IDLE_MS);
    const candidates = await this.streamModel.find({
      active: true,
      $or: [
        {
          status: LiveStatus.LIVE,
          'liveSession.provider': 'self',
          broadcastSeenAt: { $lt: staleBefore },
        },
        { status: LiveStatus.IDLE, createdAt: { $lt: abandonedBefore } },
      ],
    });
    for (const stream of candidates) {
      await this.finish(stream, 'system');
    }
    return candidates.length;
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async finish(
    stream: TeacherStreamDocument,
    by: 'tutor' | 'admin' | 'system',
  ): Promise<void> {
    const now = new Date();
    stream.active = false;
    stream.status = LiveStatus.ENDED;
    stream.liveSession.status = LiveStatus.ENDED;
    stream.liveSession.endedAt = now;
    stream.endedAt = now;
    stream.endedBy = by;
    await stream.save();

    this.emitStatus(stream);
    // Never throws: a provider hiccup must not keep a stream open.
    await this.liveStreaming.end(stream.liveSession);
  }

  private async findActiveFor(tutorId: string) {
    return this.streamModel.findOne({
      tutorId: new Types.ObjectId(tutorId),
      active: true,
    });
  }

  private async findById(id: string, withTutor = false) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Stream not found');
    }
    const query = this.streamModel.findById(id);
    if (withTutor) query.populate('tutorId', 'firstName lastName');
    const stream = await query.exec();
    if (!stream) throw new NotFoundException('Stream not found');
    return stream;
  }

  private assertOwner(stream: TeacherStreamDocument, tutorId: string) {
    if (idOf(stream.tutorId) !== tutorId) {
      throw new ForbiddenException('This is not your stream');
    }
  }

  private broadcastPayload(stream: TeacherStreamDocument) {
    const live = stream.liveSession;
    return {
      streamId: stream._id.toString(),
      title: stream.title,
      status: stream.status,
      startedAt: stream.startedAt,
      // Broadcaster secrets — only ever returned to the owning teacher.
      rtmpUrl: live.rtmpUrl,
      streamKey: live.streamKey,
      embedUrl: live.embedUrl,
      conversationId: live.conversationId?.toString() ?? null,
      provider: live.provider ?? 'vimeo',
    };
  }

  private watchSummary(stream: TeacherStreamDocument) {
    return {
      streamId: stream._id.toString(),
      status: stream.status,
      startedAt: stream.startedAt,
      endedAt: stream.endedAt,
    };
  }

  /**
   * Same `classLiveStatus` event the live-class page listens for, keyed by the
   * stream id, so the shared live hooks work for streams unchanged.
   */
  private emitStatus(stream: TeacherStreamDocument) {
    const convoId = stream.liveSession.conversationId?.toString();
    if (!convoId) return;
    this.chatGateway.emitToConversation(convoId, 'classLiveStatus', {
      classId: stream._id.toString(),
      status: stream.status,
      embedUrl: stream.active ? stream.liveSession.embedUrl : null,
    });
  }

  /**
   * Bell notification to students who have had a class with this teacher.
   * Everyone else finds the stream through the LIVE badge on the cards.
   * Best-effort: a notification failure must not fail going live.
   */
  private async notifyStudents(stream: TeacherStreamDocument): Promise<void> {
    try {
      const tutorId = new Types.ObjectId(idOf(stream.tutorId));
      const [enrolled, requesters] = await Promise.all([
        this.classModel.distinct('students', { tutorId }),
        this.classModel.distinct('requestedBy', { tutorId }),
      ]);
      const studentIds = [
        ...new Set([...enrolled, ...requesters].filter(Boolean).map(String)),
      ];
      if (studentIds.length === 0) return;

      const notice = {
        type: 'class',
        title: `Live now: ${stream.title}`,
        content: 'Your teacher just went live. Join the stream.',
        actionPayload: {
          kind: 'stream_live',
          streamId: stream._id.toString(),
          tutorId: idOf(stream.tutorId),
          joinUrl: `/student/live/${stream._id.toString()}`,
        },
      };
      await Promise.allSettled(
        studentIds.map((userId) =>
          this.notificationsService.create({ userId, ...notice }),
        ),
      );
      this.chatGateway.emitToUsers(studentIds, 'newNotification', notice);
    } catch (err: any) {
      this.logger.error(`Stream notifications failed: ${err?.message}`);
    }
  }
}
