import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ClassSession,
  ClassSessionDocument,
  ClassStatus,
  LiveStatus,
} from '../schemas/class.schema';
import {
  CreateClassDto,
  RequestClassDto,
  ApproveClassDto,
  DeclineClassDto,
} from '../dto/create-class.dto';
import { UpdateClassDto } from '../dto/update-class.dto';
import { LiveStreamingService } from '../../live/live-streaming.service';
import { ChatService } from '../../chat/chat.service';
import { ChatGateway } from '../../chat/chat.gateway';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  User,
  UserDocument,
  UserRole,
  UserStatus,
} from '../../users/schemas/user.schema';

/**
 * A tutor cancelling on the same student this many times triggers an
 * automatic suspension and an admin alert. Counted over all time — a tutor
 * who repeatedly strands the same student is a trust problem, not a
 * scheduling accident.
 */
const TUTOR_CANCELLATIONS_PER_STUDENT_LIMIT = 3;

/**
 * A tutor who lets this many scheduled classes pass without ever starting
 * them (no-shows) is auto-suspended. Unlike cancellations this is not
 * per-student — a serial no-show harms whoever was enrolled.
 */
const TUTOR_MISSED_CLASSES_LIMIT = 3;

/** How often the missed-class sweep runs. */
const MISSED_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How often the class-start sweep runs.
 *
 * Deliberately far tighter than the missed sweep: detecting a no-show can wait
 * five minutes, but "your class is starting" arriving four minutes late is
 * worse than not sending it. This interval is the worst-case lateness of the
 * alert.
 */
const CLASS_START_SWEEP_INTERVAL_MS = 60 * 1000;

@Injectable()
export class ClassesService {
  private readonly logger = new Logger(ClassesService.name);

  constructor(
    @InjectModel(ClassSession.name)
    private classSessionModel: Model<ClassSessionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly liveStreaming: LiveStreamingService,
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Tutor / Admin creates a class directly ──────────────────────────────────
  async create(
    tutorId: string,
    createClassDto: CreateClassDto,
  ): Promise<ClassSession> {
    const newClass = new this.classSessionModel({
      ...createClassDto,
      tutorId: new Types.ObjectId(tutorId),
      status: ClassStatus.SCHEDULED,
    });
    return newClass.save();
  }

  private displayName(user: any): string {
    if (!user) return 'Someone';
    return (
      `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
      user.email ||
      'Someone'
    );
  }

  /**
   * Persist a notification and push it live over the socket. Best-effort:
   * a notification failure must never break the class action that triggered
   * it, so everything here is caught and logged.
   */
  private async pushNotification(
    userId: string | Types.ObjectId,
    payload: {
      type: string;
      title: string;
      content: string;
      actionPayload?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.notificationsService.create({
        userId: String(userId),
        type: payload.type,
        title: payload.title,
        content: payload.content,
        actionPayload: payload.actionPayload,
      });
      // Real-time bell update for anyone currently connected.
      this.chatGateway.emitToUsers([String(userId)], 'newNotification', {
        type: payload.type,
        title: payload.title,
        content: payload.content,
        actionPayload: payload.actionPayload,
      });
    } catch (error) {
      this.logger.error(`Failed to notify ${String(userId)}: ${error.message}`);
    }
  }

  // ─── Student requests a class from a specific tutor ──────────────────────────
  async requestClass(
    studentId: string,
    dto: RequestClassDto,
  ): Promise<ClassSession> {
    const newClass = new this.classSessionModel({
      tutorId: new Types.ObjectId(dto.tutorId),
      requestedBy: new Types.ObjectId(studentId),
      title: dto.title,
      description: dto.description,
      startTime: dto.startTime,
      endTime: dto.endTime,
      status: ClassStatus.PENDING_APPROVAL,
      students: [new Types.ObjectId(studentId)],
    });
    const saved = await newClass.save();

    // Tell the tutor a student is requesting a class from them.
    const student = await this.userModel
      .findById(studentId)
      .select('firstName lastName email')
      .lean();
    await this.pushNotification(dto.tutorId, {
      type: 'class',
      title: 'New class request',
      content: `${this.displayName(student)} requested a class: "${dto.title}". Review it to approve or decline.`,
      actionPayload: {
        kind: 'class_request',
        classId: (saved._id as Types.ObjectId).toString(),
      },
    });

    return saved;
  }

  // ─── Tutor approves a pending class request ───────────────────────────────────
  async approveClass(
    id: string,
    tutorId: string,
    dto: ApproveClassDto,
  ): Promise<ClassSession> {
    const classSession = await this.findOne(id);

    if (
      classSession.tutorId._id?.toString() !== tutorId &&
      (classSession.tutorId as any).toString() !== tutorId
    ) {
      throw new ForbiddenException(
        'You can only approve your own class requests',
      );
    }

    if (classSession.status !== ClassStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only pending class requests can be approved',
      );
    }

    classSession.status = ClassStatus.SCHEDULED;
    if (dto.meetingLink) {
      classSession.meetingLink = dto.meetingLink;
    }
    const saved = await classSession.save();

    // Tell the student their request was approved.
    if (classSession.requestedBy) {
      await this.pushNotification(
        (classSession.requestedBy as any)._id ?? classSession.requestedBy,
        {
          type: 'class',
          title: 'Class request approved',
          content: `${this.displayName(classSession.tutorId)} approved your class: "${classSession.title}".`,
          actionPayload: { kind: 'class_approved', classId: id },
        },
      );
    }

    return saved;
  }

  // ─── Tutor declines a pending class request ───────────────────────────────────
  async declineClass(
    id: string,
    tutorId: string,
    dto: DeclineClassDto,
  ): Promise<ClassSession> {
    const classSession = await this.findOne(id);

    if (
      classSession.tutorId._id?.toString() !== tutorId &&
      (classSession.tutorId as any).toString() !== tutorId
    ) {
      throw new ForbiddenException(
        'You can only decline your own class requests',
      );
    }

    if (classSession.status !== ClassStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only pending class requests can be declined',
      );
    }

    classSession.status = ClassStatus.CANCELLED;
    classSession.declineReason = dto.declineReason || null;
    const saved = await classSession.save();

    // Tell the student their request was declined, with the reason if given.
    if (classSession.requestedBy) {
      await this.pushNotification(
        (classSession.requestedBy as any)._id ?? classSession.requestedBy,
        {
          type: 'class',
          title: 'Class request declined',
          content: dto.declineReason
            ? `${this.displayName(classSession.tutorId)} declined your class "${classSession.title}": ${dto.declineReason}`
            : `${this.displayName(classSession.tutorId)} declined your class "${classSession.title}".`,
          actionPayload: { kind: 'class_declined', classId: id },
        },
      );
    }

    return saved;
  }

  // ─── Get all pending requests for a specific tutor ───────────────────────────
  async getRequestsForTutor(tutorId: string): Promise<ClassSession[]> {
    return this.classSessionModel
      .find({
        tutorId: new Types.ObjectId(tutorId),
        status: ClassStatus.PENDING_APPROVAL,
      })
      .populate('requestedBy', 'firstName lastName email avatar')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findAll(query: any = {}): Promise<ClassSession[]> {
    return this.classSessionModel
      .find(query)
      .populate('tutorId', 'firstName lastName email')
      .populate('requestedBy', 'firstName lastName email')
      .populate('students', 'firstName lastName email')
      .populate('courseId', 'title')
      .sort({ startTime: -1 })
      .exec();
  }

  async findOne(id: string): Promise<ClassSession> {
    const classSession = await this.classSessionModel
      .findById(id)
      .populate('tutorId', 'firstName lastName email')
      .populate('requestedBy', 'firstName lastName email')
      .populate('students', 'firstName lastName email')
      .populate('courseId', 'title')
      .exec();

    if (!classSession) {
      throw new NotFoundException(`Class session with ID ${id} not found`);
    }

    return classSession;
  }

  async update(
    id: string,
    updateClassDto: UpdateClassDto,
    userId: string,
    isAdmin: boolean = false,
  ): Promise<ClassSession> {
    const classSession = await this.findOne(id);

    if (!isAdmin && classSession.tutorId._id.toString() !== userId) {
      throw new BadRequestException(
        'You do not have permission to update this class',
      );
    }

    Object.assign(classSession, updateClassDto);
    return classSession.save();
  }

  /**
   * Cancel keeps the class record (status → CANCELLED) instead of deleting
   * it — the audit trail is what powers the repeat-cancellation policy and
   * the admin's view of who cancelled what.
   */
  async cancel(
    id: string,
    actor: { userId: string; role: UserRole },
    reason?: string,
  ): Promise<ClassSession> {
    const classSession = await this.findOne(id);
    const isAdmin = actor.role === UserRole.ADMIN;

    if (!isAdmin && classSession.tutorId._id.toString() !== actor.userId) {
      throw new ForbiddenException(
        'You do not have permission to cancel this class',
      );
    }
    if (classSession.status === ClassStatus.CANCELLED) {
      throw new BadRequestException('This class is already cancelled');
    }
    if (classSession.status === ClassStatus.COMPLETED) {
      throw new BadRequestException('A completed class cannot be cancelled');
    }

    // Tear down the live event if one was provisioned (non-blocking).
    await this.liveStreaming.teardown(classSession.liveSession);

    classSession.status = ClassStatus.CANCELLED;
    classSession.cancelReason = reason ?? null;
    classSession.cancelledBy = new Types.ObjectId(actor.userId);
    classSession.cancelledByRole = isAdmin ? 'admin' : 'tutor';
    classSession.cancelledAt = new Date();
    await classSession.save();

    const studentIds: string[] = (classSession.students ?? []).map((s: any) =>
      (s._id ?? s).toString(),
    );

    // Tell enrolled students their class is off — silently vanished classes
    // are the #1 support complaint pattern.
    await Promise.allSettled(
      studentIds.map((studentId) =>
        this.notificationsService.create({
          userId: studentId,
          type: 'class',
          title: `Class cancelled: ${classSession.title}`,
          content: reason
            ? `The class was cancelled. Reason: ${reason}`
            : 'The class was cancelled.',
          actionPayload: { kind: 'class_cancelled', classId: id },
        }),
      ),
    );

    if (!isAdmin) {
      await this.enforceTutorCancellationPolicy(
        classSession.tutorId._id.toString(),
        studentIds,
      );
    }

    return classSession;
  }

  /**
   * The 3-strike rule: a tutor whose cancellations have now hit the limit
   * against any one student is suspended on the spot (the JWT strategy
   * checks status on every request, so suspension takes effect immediately)
   * and every admin is alerted for review.
   */
  private async enforceTutorCancellationPolicy(
    tutorId: string,
    studentIds: string[],
  ): Promise<void> {
    for (const studentId of studentIds) {
      const cancelCount = await this.classSessionModel.countDocuments({
        tutorId: new Types.ObjectId(tutorId),
        status: ClassStatus.CANCELLED,
        cancelledByRole: 'tutor',
        students: new Types.ObjectId(studentId),
      });
      if (cancelCount < TUTOR_CANCELLATIONS_PER_STUDENT_LIMIT) continue;

      const [tutor, student] = await Promise.all([
        this.userModel
          .findById(tutorId)
          .select('firstName lastName email status')
          .lean(),
        this.userModel
          .findById(studentId)
          .select('firstName lastName email')
          .lean(),
      ]);
      // Already suspended (e.g. a fourth strike) — alert once, not repeatedly.
      if (!tutor || tutor.status === UserStatus.SUSPENDED) return;

      await this.userModel.updateOne(
        { _id: tutorId, role: UserRole.TUTOR },
        { status: UserStatus.SUSPENDED },
      );

      const tutorName =
        `${tutor.firstName ?? ''} ${tutor.lastName ?? ''}`.trim() ||
        tutor.email;
      const studentName = student
        ? `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() ||
          student.email
        : 'a student';

      const admins = await this.userModel
        .find({ role: UserRole.ADMIN, isDeleted: { $ne: true } })
        .select('_id')
        .lean();
      await Promise.allSettled(
        admins.map((admin) =>
          this.notificationsService.create({
            userId: String(admin._id),
            type: 'security',
            title: `Tutor auto-suspended: ${tutorName}`,
            content: `${tutorName} has cancelled ${cancelCount} classes on ${studentName} and was automatically suspended. Review their account to reinstate or remove them.`,
            actionPayload: {
              kind: 'tutor_auto_suspended',
              tutorId,
              studentId,
              cancelCount,
            },
          }),
        ),
      );
      return;
    }
  }

  // ─── Class-start alerts ──────────────────────────────────────────────────

  /**
   * Cron entry point. Thin, so the real work is directly callable from tests
   * without waiting on a timer — same shape as the missed-class sweep.
   */
  @Interval('class-start-sweep', CLASS_START_SWEEP_INTERVAL_MS)
  async handleClassStartSweep(): Promise<void> {
    try {
      const result = await this.sweepStartingClasses();
      if (result.notifiedClasses > 0) {
        this.logger.log(
          `Class-start sweep: alerted students for ${result.notifiedClasses} class(es)`,
        );
      }
    } catch (error) {
      this.logger.error(`Class-start sweep failed: ${error.message}`);
    }
  }

  /**
   * Alerts enrolled students the moment their class's start time arrives.
   *
   * A class qualifies when it is SCHEDULED (approved by the tutor, not
   * cancelled and not yet started), its start time has passed, its end time
   * has not, and it has never been alerted before. Filtering on SCHEDULED
   * excludes pending-approval, cancelled, ongoing and missed classes for free.
   *
   * Each class is *claimed* before anyone is notified: the update is
   * conditioned on `startNotifiedAt` still being null, so if two API instances
   * sweep at the same moment exactly one wins and students are alerted once.
   * Notifying first and stamping afterwards would double-send under that race.
   */
  async sweepStartingClasses(now: Date = new Date()): Promise<{
    notifiedClasses: number;
    notifiedStudents: number;
  }> {
    const starting = await this.classSessionModel
      .find({
        status: ClassStatus.SCHEDULED,
        startTime: { $lte: now },
        endTime: { $gt: now },
        startNotifiedAt: null,
      })
      .select('_id title startTime students')
      .lean();

    if (starting.length === 0) {
      return { notifiedClasses: 0, notifiedStudents: 0 };
    }

    let notifiedClasses = 0;
    let notifiedStudents = 0;

    for (const c of starting) {
      // Claim first. A null result means another instance (or an earlier tick
      // of this one) already alerted this class, so we skip it entirely.
      const claimed = await this.classSessionModel
        .findOneAndUpdate(
          { _id: c._id, startNotifiedAt: null },
          { $set: { startNotifiedAt: now } },
        )
        .lean();

      if (!claimed) continue;

      const studentIds: string[] = (c.students ?? []).map((s: any) =>
        (s._id ?? s).toString(),
      );
      if (studentIds.length === 0) continue;

      await this.notifyClassAlert(studentIds, {
        kind: 'class_starting',
        classId: c._id.toString(),
        title: c.title,
        startTime: c.startTime,
        notificationTitle: `Class starting now: ${c.title}`,
        notificationBody:
          'Your scheduled class time has arrived. Open the class to join.',
      });

      notifiedClasses += 1;
      notifiedStudents += studentIds.length;
    }

    return { notifiedClasses, notifiedStudents };
  }

  /**
   * Persists a class alert for each student and pushes it live.
   *
   * Reuses the existing `newNotification` channel rather than inventing a new
   * socket event: it already reaches every logged-in client app-wide and lands
   * in the notification bell. The `kind` in `actionPayload` is what the
   * client-side modal keys off.
   */
  private async notifyClassAlert(
    studentIds: string[],
    alert: {
      kind: 'class_starting' | 'class_live';
      classId: string;
      title: string;
      startTime?: Date;
      notificationTitle: string;
      notificationBody: string;
    },
  ): Promise<void> {
    const actionPayload = {
      kind: alert.kind,
      classId: alert.classId,
      title: alert.title,
      startTime: alert.startTime ?? null,
      joinUrl: `/student/classes/${alert.classId}/live`,
    };

    // Persisted so the alert survives a reload and reaches a student who logs
    // in after it fired — a socket push alone would be lost for them.
    await Promise.allSettled(
      studentIds.map((userId) =>
        this.notificationsService.create({
          userId,
          type: 'class',
          title: alert.notificationTitle,
          content: alert.notificationBody,
          actionPayload,
        }),
      ),
    );

    this.chatGateway.emitToUsers(studentIds, 'newNotification', {
      type: 'class',
      title: alert.notificationTitle,
      content: alert.notificationBody,
      actionPayload,
    });
  }

  // ─── Missed-class detection (no-show) ────────────────────────────────────

  /**
   * Cron entry point. Kept thin so the real work (sweepMissedClasses) can be
   * called directly from tests without waiting on the timer.
   */
  @Interval('missed-class-sweep', MISSED_SWEEP_INTERVAL_MS)
  async handleMissedClassSweep(): Promise<void> {
    try {
      const result = await this.sweepMissedClasses();
      if (result.markedMissed > 0) {
        this.logger.warn(
          `Missed-class sweep: marked ${result.markedMissed} class(es) missed, suspended ${result.suspendedTutors.length} tutor(s)`,
        );
      }
    } catch (error) {
      this.logger.error(`Missed-class sweep failed: ${error.message}`);
    }
  }

  /**
   * Marks every overdue no-show as MISSED and enforces the 3-strike block.
   *
   * A class is a no-show when its end time has passed while it was still
   * merely SCHEDULED — i.e. approved but never started (startLive flips the
   * status to ONGOING, so a started class is never SCHEDULED here). Pending,
   * cancelled, ongoing and completed classes are all untouched.
   *
   * Returns a summary so the caller (and tests) can see exactly what changed.
   */
  async sweepMissedClasses(now: Date = new Date()): Promise<{
    markedMissed: number;
    suspendedTutors: string[];
  }> {
    const overdue = await this.classSessionModel
      .find({ status: ClassStatus.SCHEDULED, endTime: { $lt: now } })
      .select('_id tutorId title students')
      .lean();

    if (overdue.length === 0) {
      return { markedMissed: 0, suspendedTutors: [] };
    }

    const ids = overdue.map((c) => c._id);
    await this.classSessionModel.updateMany(
      { _id: { $in: ids }, status: ClassStatus.SCHEDULED },
      { status: ClassStatus.MISSED, missedAt: now },
    );

    // Tell enrolled students their class was missed.
    await Promise.allSettled(
      overdue.flatMap((c) =>
        (c.students ?? []).map((s: any) =>
          this.notificationsService.create({
            userId: (s._id ?? s).toString(),
            type: 'class',
            title: `Class missed: ${c.title}`,
            content:
              'The tutor did not start this class before its scheduled end time.',
            actionPayload: { kind: 'class_missed', classId: c._id.toString() },
          }),
        ),
      ),
    );

    // Enforce the 3-strike block, once per affected tutor.
    const tutorIds = [...new Set(overdue.map((c) => c.tutorId.toString()))];
    const suspendedTutors: string[] = [];
    for (const tutorId of tutorIds) {
      const suspended = await this.enforceTutorMissedPolicy(tutorId);
      if (suspended) suspendedTutors.push(tutorId);
    }

    return { markedMissed: overdue.length, suspendedTutors };
  }

  /**
   * Suspends a tutor once their MISSED count reaches the limit and alerts
   * every admin with the reason. Returns whether a suspension happened.
   */
  private async enforceTutorMissedPolicy(tutorId: string): Promise<boolean> {
    const missedCount = await this.classSessionModel.countDocuments({
      tutorId: new Types.ObjectId(tutorId),
      status: ClassStatus.MISSED,
    });
    if (missedCount < TUTOR_MISSED_CLASSES_LIMIT) return false;

    const tutor = await this.userModel
      .findById(tutorId)
      .select('firstName lastName email status role')
      .lean();
    // Not a tutor, gone, or already suspended — alert only on the transition.
    if (
      !tutor ||
      tutor.role !== UserRole.TUTOR ||
      tutor.status === UserStatus.SUSPENDED
    ) {
      return false;
    }

    await this.userModel.updateOne(
      { _id: tutorId, role: UserRole.TUTOR },
      { status: UserStatus.SUSPENDED },
    );

    const tutorName =
      `${tutor.firstName ?? ''} ${tutor.lastName ?? ''}`.trim() || tutor.email;

    const admins = await this.userModel
      .find({ role: UserRole.ADMIN, isDeleted: { $ne: true } })
      .select('_id')
      .lean();
    await Promise.allSettled(
      admins.map((admin) =>
        this.notificationsService.create({
          userId: String(admin._id),
          type: 'security',
          title: `Tutor auto-suspended: ${tutorName}`,
          content: `${tutorName} missed ${missedCount} scheduled classes (did not start them before their end time) and was automatically suspended. Review their account to reinstate or remove them.`,
          actionPayload: {
            kind: 'tutor_auto_suspended',
            reason: 'missed_classes',
            tutorId,
            missedCount,
          },
        }),
      ),
    );

    this.logger.warn(
      `Auto-suspended tutor ${tutorId}: ${missedCount} missed classes`,
    );
    return true;
  }

  async remove(
    id: string,
    userId: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    const classSession = await this.findOne(id);

    if (!isAdmin && classSession.tutorId._id.toString() !== userId) {
      throw new BadRequestException(
        'You do not have permission to delete this class',
      );
    }

    // Tear down the live event if one was provisioned (non-blocking).
    await this.liveStreaming.teardown(classSession.liveSession);

    await this.classSessionModel.findByIdAndDelete(id).exec();
  }

  async enrollStudent(id: string, studentId: string): Promise<ClassSession> {
    const classSession = await this.findOne(id);

    const isEnrolled = classSession.students.some(
      (student: any) => student._id.toString() === studentId,
    );

    if (isEnrolled) {
      throw new BadRequestException(
        'Student is already enrolled in this class',
      );
    }

    classSession.students.push(new Types.ObjectId(studentId));
    return classSession.save();
  }

  // ─── Live class (Vimeo/YouTube broadcast + Q&A chat) ─────────────────────────

  private assertTutorOwns(classSession: ClassSession, tutorId: string) {
    const ownerId =
      (classSession.tutorId as any)?._id?.toString() ??
      (classSession.tutorId as any)?.toString();
    if (ownerId !== tutorId) {
      throw new ForbiddenException('You are not the tutor for this class');
    }
  }

  private participantIds(classSession: ClassSession): string[] {
    const tutor =
      (classSession.tutorId as any)?._id?.toString() ??
      (classSession.tutorId as any)?.toString();
    const students = (classSession.students || []).map(
      (s: any) => s?._id?.toString() ?? s?.toString(),
    );
    return Array.from(new Set([tutor, ...students].filter(Boolean)));
  }

  private isEnrolled(classSession: ClassSession, userId: string): boolean {
    return this.participantIds(classSession).includes(userId);
  }

  /**
   * Provision (idempotently) the live broadcast + Q&A conversation for a
   * class, then return the tutor's broadcast credentials. Tutor-only.
   */
  async setupLive(classId: string, tutorId: string) {
    const classSession = await this.findOne(classId);
    this.assertTutorOwns(classSession, tutorId);

    if (classSession.status === ClassStatus.CANCELLED) {
      throw new BadRequestException(
        'Cannot start a live session for a cancelled class',
      );
    }

    // Create the broadcast once, on whichever provider is configured.
    if (!this.liveStreaming.hasEvent(classSession.liveSession)) {
      const event = await this.liveStreaming.provision(classSession.title);
      classSession.liveSession.provider = event.provider;
      classSession.liveSession.vimeoEventId = event.vimeoEventId;
      classSession.liveSession.youtubeBroadcastId = event.youtubeBroadcastId;
      classSession.liveSession.youtubeStreamId = event.youtubeStreamId;
      classSession.liveSession.rtmpUrl = event.rtmpUrl;
      classSession.liveSession.streamKey = event.streamKey;
      classSession.liveSession.embedUrl = event.embedUrl;
      classSession.liveSession.status = LiveStatus.IDLE;
    } else if (
      !classSession.liveSession.rtmpUrl ||
      !classSession.liveSession.streamKey
    ) {
      // Credentials weren't captured yet — re-fetch from the owning provider.
      const event = await this.liveStreaming.refresh(classSession.liveSession);
      classSession.liveSession.rtmpUrl = event.rtmpUrl;
      classSession.liveSession.streamKey = event.streamKey;
      classSession.liveSession.embedUrl = event.embedUrl;
    }

    // Create the shared Q&A conversation once.
    if (!classSession.liveSession?.conversationId) {
      const convo = await this.chatService.createConversation(
        this.participantIds(classSession),
      );
      classSession.liveSession.conversationId = convo._id as Types.ObjectId;
    }

    await classSession.save();
    return this.broadcastPayload(classSession);
  }

  /** Tutor-only: fetch RTMP ingest credentials (auto-provisions if needed). */
  async getBroadcastInfo(classId: string, tutorId: string) {
    const classSession = await this.findOne(classId);
    this.assertTutorOwns(classSession, tutorId);

    if (!this.liveStreaming.hasEvent(classSession.liveSession)) {
      // Not set up yet — provision now.
      return this.setupLive(classId, tutorId);
    }
    return this.broadcastPayload(classSession);
  }

  /**
   * Student/tutor view for watching: embed URL + Q&A room, never the secrets.
   * Late enrollees are added to the Q&A room on demand.
   */
  async getWatchInfo(classId: string, userId: string, role: string) {
    const classSession = await this.findOne(classId);

    const isPrivileged = role === 'admin';
    if (!isPrivileged && !this.isEnrolled(classSession, userId)) {
      throw new ForbiddenException('You are not enrolled in this class');
    }

    const live = classSession.liveSession;

    // Ensure the viewer can post in the Q&A room.
    if (live?.conversationId) {
      await this.chatService.addParticipant(
        live.conversationId.toString(),
        userId,
      );
    }

    return {
      classId: (classSession._id as Types.ObjectId).toString(),
      title: classSession.title,
      status: classSession.status,
      startTime: classSession.startTime,
      endTime: classSession.endTime,
      live: {
        status: live?.status ?? LiveStatus.IDLE,
        embedUrl: live?.embedUrl ?? null,
        conversationId: live?.conversationId?.toString() ?? null,
        recordingUrl: live?.recordingUrl ?? null,
      },
    };
  }

  /** Tutor flips the broadcast live and notifies enrolled viewers. */
  async startLive(classId: string, tutorId: string) {
    const classSession = await this.findOne(classId);
    this.assertTutorOwns(classSession, tutorId);

    if (!this.liveStreaming.hasEvent(classSession.liveSession)) {
      throw new BadRequestException(
        'Set up the live session before going live',
      );
    }

    // Going live a second time must not re-alert everyone. The status check
    // is what makes a double-click on "Go Live" harmless.
    const wasAlreadyLive = classSession.liveSession.status === LiveStatus.LIVE;

    classSession.liveSession.status = LiveStatus.LIVE;
    classSession.liveSession.startedAt = new Date();
    classSession.status = ClassStatus.ONGOING;
    await classSession.save();

    this.emitLiveStatus(classSession, LiveStatus.LIVE);

    // `emitLiveStatus` only reaches clients sitting on the live-class page.
    // This is what tells a student who is anywhere else in the app — or not
    // looking at all — that there is now something to join.
    if (!wasAlreadyLive) {
      const studentIds: string[] = (classSession.students ?? []).map((s: any) =>
        (s._id ?? s).toString(),
      );

      if (studentIds.length > 0) {
        await this.notifyClassAlert(studentIds, {
          kind: 'class_live',
          classId: (classSession._id as Types.ObjectId).toString(),
          title: classSession.title,
          startTime: classSession.startTime,
          notificationTitle: `Your class is live: ${classSession.title}`,
          notificationBody: 'Your instructor has started the class. Join now.',
        });
      }
    }

    return this.watchSummary(classSession);
  }

  /** Tutor ends the broadcast and marks the class completed. */
  async endLive(classId: string, tutorId: string) {
    const classSession = await this.findOne(classId);
    this.assertTutorOwns(classSession, tutorId);

    classSession.liveSession.status = LiveStatus.ENDED;
    classSession.liveSession.endedAt = new Date();
    classSession.status = ClassStatus.COMPLETED;
    await classSession.save();

    this.emitLiveStatus(classSession, LiveStatus.ENDED);

    // Best-effort: complete the broadcast on its provider (and, for YouTube
    // in live-only mode, remove the auto-archived video). The facade never
    // throws here — a provider hiccup must not block ending the class.
    await this.liveStreaming.end(classSession.liveSession);

    return this.watchSummary(classSession);
  }

  private broadcastPayload(classSession: ClassSession) {
    const live = classSession.liveSession;
    return {
      classId: (classSession._id as Types.ObjectId).toString(),
      title: classSession.title,
      status: live.status,
      // Broadcaster secrets — only ever returned from this tutor-guarded path.
      rtmpUrl: live.rtmpUrl,
      streamKey: live.streamKey,
      embedUrl: live.embedUrl,
      conversationId: live.conversationId?.toString() ?? null,
      provider: live.provider ?? 'vimeo',
      vimeoEventId: live.vimeoEventId,
      youtubeBroadcastId: live.youtubeBroadcastId ?? null,
    };
  }

  private watchSummary(classSession: ClassSession) {
    const live = classSession.liveSession;
    return {
      classId: (classSession._id as Types.ObjectId).toString(),
      status: classSession.status,
      live: {
        status: live.status,
        embedUrl: live.embedUrl,
        conversationId: live.conversationId?.toString() ?? null,
      },
    };
  }

  private emitLiveStatus(classSession: ClassSession, status: LiveStatus) {
    const payload = {
      classId: (classSession._id as Types.ObjectId).toString(),
      status,
      embedUrl: classSession.liveSession.embedUrl,
    };
    // Push to the Q&A room and directly to each enrolled user.
    const convoId = classSession.liveSession.conversationId?.toString();
    if (convoId) {
      this.chatGateway.emitToConversation(convoId, 'classLiveStatus', payload);
    }
    this.chatGateway.emitToUsers(
      this.participantIds(classSession),
      'classLiveStatus',
      payload,
    );
  }
}
