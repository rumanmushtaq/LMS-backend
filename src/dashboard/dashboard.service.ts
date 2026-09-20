import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  ClassSession,
  ClassSessionDocument,
  ClassStatus,
  LiveStatus,
} from '../classes/schemas/class.schema';
import { TUTOR_MISSED_CLASSES_LIMIT } from '../classes/classes.constants';
import {
  Notification,
  NotificationDocument,
} from '../notifications/schemas/notification.schema';
import {
  Conversation,
  ConversationDocument,
} from '../chat/schemas/conversation.schema';
import { Message, MessageDocument } from '../chat/schemas/message.schema';
import {
  TutorMaterial,
  TutorMaterialDocument,
} from '../tutor-materials/schemas/tutor-material.schema';
import {
  MaterialPurchase,
  MaterialPurchaseDocument,
} from '../tutor-materials/schemas/material-purchase.schema';
import { PaymentsService } from '../payments/services/payments.service';
import { PlatformSettingsService } from '../payments/services/platform-settings.service';
import { UserDocument, UserRole } from '../users/schemas/user.schema';
import {
  ACTIVITY_MONTHS,
  DashboardSummary,
  MonthlyActivity,
  NEXT_CLASSES_LIMIT,
  ProfileField,
  STUDENT_PROFILE_FIELDS,
  StudentDashboardSummary,
  StudentNextClass,
  TUTOR_PROFILE_FIELDS,
  TutorDashboardSummary,
  TutorNextClass,
  UnreadCounts,
} from './dashboard.types';

/** Statuses that mean the class is over — it can never be "live" again. */
const TERMINAL_STATUSES = [
  ClassStatus.COMPLETED,
  ClassStatus.CANCELLED,
  ClassStatus.MISSED,
];

/** A class row as the lean `nextClasses` projection returns it. */
interface LeanNextClass {
  _id: Types.ObjectId;
  title: string;
  startTime: Date;
  endTime: Date;
  status: ClassStatus;
  maxStudents?: number | null;
  students?: Types.ObjectId[];
  liveSession?: { status?: LiveStatus | string | null } | null;
  tutorId?:
    | { _id: Types.ObjectId; firstName: string; lastName: string }
    | Types.ObjectId
    | null;
}

/**
 * The one aggregate behind `GET /dashboard/summary`.
 *
 * Follows `AdminService.getDashboardStats`: independent queries fan out under
 * `Promise.all`, the controller only delegates, and the return shape is an
 * exported interface rather than an inline object type.
 *
 * Three of these numbers cannot be assembled by a client from the existing
 * endpoints at any number of round trips — a global unread-message total
 * (`getConversations` slices in memory), a tutor's distinct student count, and
 * monthly activity — which is why this endpoint exists at all.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(ClassSession.name)
    private readonly classSessionModel: Model<ClassSessionDocument>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(TutorMaterial.name)
    private readonly tutorMaterialModel: Model<TutorMaterialDocument>,
    @InjectModel(MaterialPurchase.name)
    private readonly materialPurchaseModel: Model<MaterialPurchaseDocument>,
    private readonly payments: PaymentsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async getSummary(user: UserDocument): Promise<DashboardSummary> {
    if (user.role === UserRole.TUTOR) return this.tutorSummary(user);
    if (user.role === UserRole.STUDENT) return this.studentSummary(user);

    // Admins have their own dashboard; there is no sensible role-neutral
    // answer, and inventing one would mean inventing numbers.
    throw new ForbiddenException(
      'Dashboard summary is only available to students and tutors',
    );
  }

  // =====================
  // STUDENT
  // =====================

  private async studentSummary(
    user: UserDocument,
  ): Promise<StudentDashboardSummary> {
    const userId = new Types.ObjectId(user._id.toString());
    const now = new Date();

    // A student is attached to a class either by being enrolled or by having
    // requested it — a request awaiting approval has no `students` entry yet.
    const scope: FilterQuery<ClassSessionDocument> = {
      $or: [{ students: userId }, { requestedBy: userId }],
    };

    const [
      liveNow,
      upcoming,
      pendingApproval,
      completed,
      cancelled,
      nextClassRows,
      scheduledMinutes,
      unread,
      materialsOwned,
    ] = await Promise.all([
      this.classSessionModel.countDocuments(
        this.and(scope, this.liveNowFilter()),
      ),
      this.classSessionModel.countDocuments({
        ...scope,
        status: ClassStatus.SCHEDULED,
        startTime: { $gt: now },
      }),
      this.classSessionModel.countDocuments({
        ...scope,
        status: ClassStatus.PENDING_APPROVAL,
      }),
      this.classSessionModel.countDocuments({
        ...scope,
        status: ClassStatus.COMPLETED,
      }),
      this.classSessionModel.countDocuments({
        ...scope,
        status: ClassStatus.CANCELLED,
      }),
      this.classSessionModel
        .find({ ...scope, ...this.nextClassesFilter(now) })
        .select('title startTime endTime status liveSession.status tutorId')
        .populate('tutorId', 'firstName lastName')
        .sort({ startTime: 1 })
        .limit(NEXT_CLASSES_LIMIT)
        .lean()
        .exec(),
      this.completedMinutes(scope),
      this.unreadCounts(userId),
      // Count only. `amountPaid` is mock money on this branch, so summing it
      // would put an invented figure on the dashboard.
      this.materialPurchaseModel.countDocuments({
        studentId: userId,
        status: 'paid',
      }),
    ]);

    return {
      role: 'student',
      classes: { liveNow, upcoming, pendingApproval, completed, cancelled },
      nextClasses: (nextClassRows as unknown as LeanNextClass[]).map((row) =>
        this.toStudentNextClass(row),
      ),
      scheduledMinutes,
      unread,
      materialsOwned,
      profileCompletenessPercent: this.profileCompleteness(
        user,
        STUDENT_PROFILE_FIELDS,
      ),
    };
  }

  // =====================
  // TUTOR
  // =====================

  private async tutorSummary(
    user: UserDocument,
  ): Promise<TutorDashboardSummary> {
    const userId = new Types.ObjectId(user._id.toString());
    const now = new Date();
    const scope: FilterQuery<ClassSessionDocument> = { tutorId: userId };

    const [
      liveNow,
      upcoming,
      pendingRequests,
      completed,
      missed,
      nextClassRows,
      seats,
      distinctTotal,
      balance,
      currency,
      activityByMonth,
      unread,
      materialsPublished,
    ] = await Promise.all([
      this.classSessionModel.countDocuments(
        this.and(scope, this.liveNowFilter()),
      ),
      this.classSessionModel.countDocuments({
        ...scope,
        status: ClassStatus.SCHEDULED,
        startTime: { $gt: now },
      }),
      this.classSessionModel.countDocuments({
        ...scope,
        status: ClassStatus.PENDING_APPROVAL,
      }),
      this.classSessionModel.countDocuments({
        ...scope,
        status: ClassStatus.COMPLETED,
      }),
      this.classSessionModel.countDocuments({
        ...scope,
        status: ClassStatus.MISSED,
      }),
      this.classSessionModel
        .find({ ...scope, ...this.nextClassesFilter(now) })
        .select(
          'title startTime endTime status liveSession.status students maxStudents',
        )
        .sort({ startTime: 1 })
        .limit(NEXT_CLASSES_LIMIT)
        .lean()
        .exec(),
      this.seatTotals(userId),
      this.distinctStudentCount(userId),
      this.payments.sellerBalance(user._id.toString()),
      this.settings.currency(),
      this.completedByMonth(userId, now),
      this.unreadCounts(userId),
      this.tutorMaterialModel.countDocuments({ tutorId: userId }),
    ]);

    return {
      role: 'tutor',
      classes: { liveNow, upcoming, pendingRequests, completed, missed },
      nextClasses: (nextClassRows as unknown as LeanNextClass[]).map((row) =>
        this.toTutorNextClass(row),
      ),
      seats,
      students: { distinctTotal },
      earnings: { ...balance, currency },
      activityByMonth,
      unread,
      materialsPublished,
      onboarding: {
        step: user.onboardingStep,
        status: user.status,
        // The platform auto-suspends on the third no-show and currently warns
        // nobody. Same count as `classes.missed`, surfaced where it is a
        // warning rather than a statistic.
        strikes: { missed, limit: TUTOR_MISSED_CLASSES_LIMIT },
      },
      profileCompletenessPercent: this.profileCompleteness(
        user,
        TUTOR_PROFILE_FIELDS,
      ),
    };
  }

  // =====================
  // SHARED QUERIES
  // =====================

  /**
   * Combines two filters that both use `$or`.
   *
   * Spreading them would silently drop the first `$or` — the same key twice in
   * one object literal keeps only the last.
   */
  private and(
    ...filters: FilterQuery<ClassSessionDocument>[]
  ): FilterQuery<ClassSessionDocument> {
    return { $and: filters };
  }

  /**
   * On air right now.
   *
   * `status: ONGOING` is the authority, but a broadcast can be live while the
   * status write is still in flight, so a live `liveSession` counts too —
   * except on a class that has already ended, where a stale `live` marker
   * would otherwise resurrect it forever.
   */
  private liveNowFilter(): FilterQuery<ClassSessionDocument> {
    return {
      $or: [
        { status: ClassStatus.ONGOING },
        {
          'liveSession.status': LiveStatus.LIVE,
          status: { $nin: TERMINAL_STATUSES },
        },
      ],
    };
  }

  /**
   * What the "next up" list shows: anything not yet finished.
   *
   * Filtering on `endTime` rather than `startTime` keeps a class that is
   * currently running at the top of the list instead of dropping it the
   * moment it begins — that is exactly when its Join button matters most.
   */
  private nextClassesFilter(now: Date): FilterQuery<ClassSessionDocument> {
    return {
      status: { $in: [ClassStatus.SCHEDULED, ClassStatus.ONGOING] },
      endTime: { $gte: now },
    };
  }

  /** Total scheduled length of COMPLETED classes, in whole minutes. */
  private async completedMinutes(
    scope: FilterQuery<ClassSessionDocument>,
  ): Promise<number> {
    const [totals] = await this.classSessionModel.aggregate<{ ms: number }>([
      { $match: { ...scope, status: ClassStatus.COMPLETED } },
      {
        $group: {
          _id: null,
          ms: { $sum: { $subtract: ['$endTime', '$startTime'] } },
        },
      },
    ]);

    // Guard against a class saved with endTime before startTime — bad data
    // should read as zero, never as negative time.
    return Math.max(0, Math.round((totals?.ms ?? 0) / 60000));
  }

  /** Seats sold vs capacity across the tutor's group classes. */
  private async seatTotals(
    tutorId: Types.ObjectId,
  ): Promise<{ sold: number; capacity: number }> {
    const [totals] = await this.classSessionModel.aggregate<{
      sold: number;
      capacity: number;
    }>([
      // Private classes have a capacity of 1 by schema default; counting them
      // would turn every one-to-one lesson into a "sold seat".
      { $match: { tutorId, visibility: 'group' } },
      {
        $group: {
          _id: null,
          sold: { $sum: { $size: { $ifNull: ['$students', []] } } },
          capacity: { $sum: { $ifNull: ['$maxStudents', 0] } },
        },
      },
    ]);

    return { sold: totals?.sold ?? 0, capacity: totals?.capacity ?? 0 };
  }

  /**
   * How many different people this tutor has taught.
   *
   * Deduped in MongoDB: a tutor with hundreds of classes would otherwise mean
   * pulling every roster into Node just to build a Set.
   */
  private async distinctStudentCount(tutorId: Types.ObjectId): Promise<number> {
    const [totals] = await this.classSessionModel.aggregate<{ total: number }>([
      { $match: { tutorId } },
      { $unwind: '$students' },
      { $group: { _id: '$students' } },
      { $count: 'total' },
    ]);

    return totals?.total ?? 0;
  }

  /**
   * Classes completed per month over the last `ACTIVITY_MONTHS` months,
   * including the current one.
   *
   * Always returns a full run of buckets. A sparse series would make a quiet
   * month indistinguishable from a month the chart simply forgot to plot.
   */
  private async completedByMonth(
    tutorId: Types.ObjectId,
    now: Date,
  ): Promise<MonthlyActivity[]> {
    const windowStart = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - (ACTIVITY_MONTHS - 1),
        1,
      ),
    );

    const rows = await this.classSessionModel.aggregate<{
      _id: string;
      count: number;
    }>([
      {
        $match: {
          tutorId,
          status: ClassStatus.COMPLETED,
          // When the class happened, not when its row was written — a class
          // booked in March and taught in May belongs to May.
          startTime: { $gte: windowStart },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$startTime' } },
          count: { $sum: 1 },
        },
      },
    ]);

    const byMonth = new Map(rows.map((r) => [r._id, r.count]));

    return Array.from({ length: ACTIVITY_MONTHS }, (_, i) => {
      const d = new Date(
        Date.UTC(
          windowStart.getUTCFullYear(),
          windowStart.getUTCMonth() + i,
          1,
        ),
      );
      const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      return { month, completed: byMonth.get(month) ?? 0 };
    });
  }

  /**
   * Unread notifications and the **global** unread message total.
   *
   * The message half cannot be taken from `GET /chat/conversations`: that
   * endpoint slices to a page in memory, so summing its badges under-counts
   * anyone past the page size. Class Q&A rooms are excluded for the same
   * reason the chat list excludes them — legacy rows have no `type`, hence
   * `$ne` rather than an equality test.
   */
  private async unreadCounts(userId: Types.ObjectId): Promise<UnreadCounts> {
    const [notifications, conversations] = await Promise.all([
      this.notificationModel.countDocuments({ userId, read: false }),
      this.conversationModel
        .find({ participants: userId, type: { $ne: 'class' } })
        .select('_id')
        .lean()
        .exec(),
    ]);

    if (conversations.length === 0) return { notifications, messages: 0 };

    const messages = await this.messageModel.countDocuments({
      conversationId: { $in: conversations.map((c) => c._id) },
      // Your own messages are never unread to you.
      senderId: { $ne: userId },
      isRead: false,
    });

    return { notifications, messages };
  }

  // =====================
  // MAPPERS
  // =====================

  private toStudentNextClass(row: LeanNextClass): StudentNextClass {
    const tutor =
      row.tutorId &&
      typeof row.tutorId === 'object' &&
      'firstName' in row.tutorId
        ? {
            _id: row.tutorId._id.toString(),
            firstName: row.tutorId.firstName,
            lastName: row.tutorId.lastName,
          }
        : null;

    return { ...this.toNextClassBase(row), tutor };
  }

  private toTutorNextClass(row: LeanNextClass): TutorNextClass {
    return {
      ...this.toNextClassBase(row),
      enrolled: row.students?.length ?? 0,
      // Null rather than 0 for a class with no declared limit — "no cap" and
      // "no seats" are different things and the frontend renders them apart.
      maxStudents: typeof row.maxStudents === 'number' ? row.maxStudents : null,
    };
  }

  private toNextClassBase(row: LeanNextClass) {
    return {
      _id: row._id.toString(),
      title: row.title,
      startTime: row.startTime,
      endTime: row.endTime,
      status: row.status,
      liveStatus: row.liveSession?.status ?? null,
    };
  }

  // =====================
  // PROFILE COMPLETENESS
  // =====================

  /**
   * Percentage of `fields` that hold a value, rounded to an integer.
   *
   * The field list is an exported constant rather than a literal in here so
   * the number is auditable — anyone can read exactly what it is a percentage
   * *of*, which is the difference between a real metric and a vibe.
   */
  private profileCompleteness(
    user: UserDocument,
    fields: ProfileField[],
  ): number {
    if (fields.length === 0) return 0;

    const kycData: Record<string, unknown> = user.kycData ?? {};
    const filled = fields.filter((field) =>
      field.sources.some((source) => this.hasValue(kycData[source])),
    ).length;

    return Math.round((filled / fields.length) * 100);
  }

  /** Empty strings, empty arrays and zero prices do not count as filled in. */
  private hasValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return value > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return Boolean(value);
  }
}
