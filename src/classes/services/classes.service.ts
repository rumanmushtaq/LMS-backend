import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ClassSession, ClassSessionDocument, ClassStatus, LiveStatus } from '../schemas/class.schema';
import { CreateClassDto, RequestClassDto, ApproveClassDto, DeclineClassDto } from '../dto/create-class.dto';
import { UpdateClassDto } from '../dto/update-class.dto';
import { VimeoService } from '../../vimeo/vimeo.service';
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

@Injectable()
export class ClassesService {
  constructor(
    @InjectModel(ClassSession.name) private classSessionModel: Model<ClassSessionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly vimeoService: VimeoService,
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Tutor / Admin creates a class directly ──────────────────────────────────
  async create(tutorId: string, createClassDto: CreateClassDto): Promise<ClassSession> {
    const newClass = new this.classSessionModel({
      ...createClassDto,
      tutorId: new Types.ObjectId(tutorId),
      status: ClassStatus.SCHEDULED,
    });
    return newClass.save();
  }

  // ─── Student requests a class from a specific tutor ──────────────────────────
  async requestClass(studentId: string, dto: RequestClassDto): Promise<ClassSession> {
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
    return newClass.save();
  }

  // ─── Tutor approves a pending class request ───────────────────────────────────
  async approveClass(id: string, tutorId: string, dto: ApproveClassDto): Promise<ClassSession> {
    const classSession = await this.findOne(id);

    if (
      classSession.tutorId._id?.toString() !== tutorId &&
      (classSession.tutorId as any).toString() !== tutorId
    ) {
      throw new ForbiddenException('You can only approve your own class requests');
    }

    if (classSession.status !== ClassStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only pending class requests can be approved');
    }

    classSession.status = ClassStatus.SCHEDULED;
    if (dto.meetingLink) {
      classSession.meetingLink = dto.meetingLink;
    }
    return classSession.save();
  }

  // ─── Tutor declines a pending class request ───────────────────────────────────
  async declineClass(id: string, tutorId: string, dto: DeclineClassDto): Promise<ClassSession> {
    const classSession = await this.findOne(id);

    if (
      classSession.tutorId._id?.toString() !== tutorId &&
      (classSession.tutorId as any).toString() !== tutorId
    ) {
      throw new ForbiddenException('You can only decline your own class requests');
    }

    if (classSession.status !== ClassStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only pending class requests can be declined');
    }

    classSession.status = ClassStatus.CANCELLED;
    classSession.declineReason = dto.declineReason || null;
    return classSession.save();
  }

  // ─── Get all pending requests for a specific tutor ───────────────────────────
  async getRequestsForTutor(tutorId: string): Promise<ClassSession[]> {
    return this.classSessionModel
      .find({ tutorId: new Types.ObjectId(tutorId), status: ClassStatus.PENDING_APPROVAL })
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
      throw new BadRequestException('You do not have permission to update this class');
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
      throw new ForbiddenException('You do not have permission to cancel this class');
    }
    if (classSession.status === ClassStatus.CANCELLED) {
      throw new BadRequestException('This class is already cancelled');
    }
    if (classSession.status === ClassStatus.COMPLETED) {
      throw new BadRequestException('A completed class cannot be cancelled');
    }

    // Tear down the Vimeo live event if one was provisioned (non-blocking).
    const eventId = classSession.liveSession?.vimeoEventId;
    if (eventId) {
      await this.vimeoService.deleteLiveEvent(eventId);
    }

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
        this.userModel.findById(tutorId).select('firstName lastName email status').lean(),
        this.userModel.findById(studentId).select('firstName lastName email').lean(),
      ]);
      // Already suspended (e.g. a fourth strike) — alert once, not repeatedly.
      if (!tutor || tutor.status === UserStatus.SUSPENDED) return;

      await this.userModel.updateOne(
        { _id: tutorId, role: UserRole.TUTOR },
        { status: UserStatus.SUSPENDED },
      );

      const tutorName = `${tutor.firstName ?? ''} ${tutor.lastName ?? ''}`.trim() || tutor.email;
      const studentName = student
        ? `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || student.email
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
            actionPayload: { kind: 'tutor_auto_suspended', tutorId, studentId, cancelCount },
          }),
        ),
      );
      return;
    }
  }

  async remove(id: string, userId: string, isAdmin: boolean = false): Promise<void> {
    const classSession = await this.findOne(id);

    if (!isAdmin && classSession.tutorId._id.toString() !== userId) {
      throw new BadRequestException('You do not have permission to delete this class');
    }

    // Tear down the Vimeo live event if one was provisioned (non-blocking).
    const eventId = classSession.liveSession?.vimeoEventId;
    if (eventId) {
      await this.vimeoService.deleteLiveEvent(eventId);
    }

    await this.classSessionModel.findByIdAndDelete(id).exec();
  }

  async enrollStudent(id: string, studentId: string): Promise<ClassSession> {
    const classSession = await this.findOne(id);

    const isEnrolled = classSession.students.some(
      (student: any) => student._id.toString() === studentId,
    );

    if (isEnrolled) {
      throw new BadRequestException('Student is already enrolled in this class');
    }

    classSession.students.push(new Types.ObjectId(studentId));
    return classSession.save();
  }

  // ─── Live class (Vimeo broadcast + Q&A chat) ─────────────────────────────────

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
   * Provision (idempotently) the Vimeo live event + Q&A conversation for a
   * class, then return the tutor's broadcast credentials. Tutor-only.
   */
  async setupLive(classId: string, tutorId: string) {
    const classSession = await this.findOne(classId);
    this.assertTutorOwns(classSession, tutorId);

    if (classSession.status === ClassStatus.CANCELLED) {
      throw new BadRequestException('Cannot start a live session for a cancelled class');
    }

    // Create the Vimeo event once.
    if (!classSession.liveSession?.vimeoEventId) {
      const event = await this.vimeoService.createLiveEvent(classSession.title);
      classSession.liveSession.vimeoEventId = event.eventId;
      classSession.liveSession.rtmpUrl = event.rtmpUrl;
      classSession.liveSession.streamKey = event.streamKey;
      classSession.liveSession.embedUrl = event.embedUrl;
      classSession.liveSession.status = LiveStatus.IDLE;
    } else if (!classSession.liveSession.rtmpUrl || !classSession.liveSession.streamKey) {
      // Credentials weren't captured yet — re-fetch from Vimeo.
      const event = await this.vimeoService.getLiveEvent(classSession.liveSession.vimeoEventId);
      classSession.liveSession.rtmpUrl = event.rtmpUrl;
      classSession.liveSession.streamKey = event.streamKey;
      classSession.liveSession.embedUrl = event.embedUrl;
    }

    // Create the shared Q&A conversation once.
    if (!classSession.liveSession?.conversationId) {
      const convo = await this.chatService.createConversation(this.participantIds(classSession));
      classSession.liveSession.conversationId = convo._id as Types.ObjectId;
    }

    await classSession.save();
    return this.broadcastPayload(classSession);
  }

  /** Tutor-only: fetch RTMP ingest credentials (auto-provisions if needed). */
  async getBroadcastInfo(classId: string, tutorId: string) {
    const classSession = await this.findOne(classId);
    this.assertTutorOwns(classSession, tutorId);

    if (!classSession.liveSession?.vimeoEventId) {
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
      await this.chatService.addParticipant(live.conversationId.toString(), userId);
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

    if (!classSession.liveSession?.vimeoEventId) {
      throw new BadRequestException('Set up the live session before going live');
    }

    classSession.liveSession.status = LiveStatus.LIVE;
    classSession.liveSession.startedAt = new Date();
    classSession.status = ClassStatus.ONGOING;
    await classSession.save();

    this.emitLiveStatus(classSession, LiveStatus.LIVE);
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
      vimeoEventId: live.vimeoEventId,
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
    this.chatGateway.emitToUsers(this.participantIds(classSession), 'classLiveStatus', payload);
  }
}
