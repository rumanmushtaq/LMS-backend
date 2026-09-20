import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DashboardService } from './dashboard.service';
import { ClassStatus, LiveStatus } from '../classes/schemas/class.schema';
import {
  OnboardingStep,
  UserRole,
  UserStatus,
} from '../users/schemas/user.schema';

/**
 * These cover the parts that are easy to get quietly wrong: the role branch,
 * deduping a student who appears on several rosters, a six-month series that
 * must stay six months long when nothing happened, an account with no data at
 * all, and an unread total that has to ignore your own messages and the class
 * Q&A rooms.
 *
 * Plain jest doubles, no Nest TestingModule — same style as
 * `admin.service.spec.ts` and `chat.service.spec.ts`.
 */

// Fixed "now" so the month buckets are deterministic.
const NOW = new Date('2026-09-20T12:00:00.000Z');

const STUDENT_ID = '5aaaaaaaaaaaaaaaaaaaaaa1';
const TUTOR_ID = '5bbbbbbbbbbbbbbbbbbbbbb2';
const OTHER_ID = '5ccccccccccccccccccccc13';

const oid = (id: string) => new Types.ObjectId(id);
const sameId = (a: unknown, b: unknown) => String(a) === String(b);

interface ClassCounts {
  liveNow?: number;
  upcoming?: number;
  pending?: number;
  completed?: number;
  cancelled?: number;
  missed?: number;
}

interface Fixture {
  counts?: ClassCounts;
  /** Rows the `nextClasses` query resolves with. */
  nextClasses?: any[];
  /** Rosters the distinct-student aggregation runs over. */
  classRosters?: { students: Types.ObjectId[] }[];
  /** `{ _id: 'YYYY-MM', count }` rows from the monthly activity aggregation. */
  monthly?: { _id: string; count: number }[];
  scheduledMs?: number;
  seats?: { sold: number; capacity: number };
  conversations?: {
    _id: Types.ObjectId;
    participants: Types.ObjectId[];
    type: string;
  }[];
  messages?: {
    conversationId: Types.ObjectId;
    senderId: Types.ObjectId;
    isRead: boolean;
  }[];
  notifications?: number;
  materialsOwned?: number;
  materialsPublished?: number;
  balance?: Record<string, number>;
  currency?: string;
}

/** A find() chain that swallows select/populate/sort/limit/lean and resolves rows. */
function findChain(rows: any[]) {
  const chain: any = {};
  for (const method of ['select', 'populate', 'sort', 'limit', 'lean']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.exec = jest.fn(() => Promise.resolve(rows));
  return chain;
}

function matchesConversation(conv: any, filter: any): boolean {
  if (filter.participants !== undefined) {
    if (!conv.participants.some((p: any) => sameId(p, filter.participants))) {
      return false;
    }
  }
  if (filter.type?.$ne !== undefined && conv.type === filter.type.$ne) {
    return false;
  }
  return true;
}

function matchesMessage(msg: any, filter: any): boolean {
  if (filter.conversationId?.$in !== undefined) {
    if (
      !filter.conversationId.$in.some((id: any) =>
        sameId(id, msg.conversationId),
      )
    ) {
      return false;
    }
  }
  if (
    filter.senderId?.$ne !== undefined &&
    sameId(msg.senderId, filter.senderId.$ne)
  ) {
    return false;
  }
  if (filter.isRead !== undefined && msg.isRead !== filter.isRead) return false;
  return true;
}

function build(fx: Fixture = {}) {
  const counts = fx.counts ?? {};

  const classSessionModel: any = {
    // The status in the filter identifies which tile is being counted; the
    // live-now filter is the only one that arrives wrapped in `$and`.
    countDocuments: jest.fn((filter: any) => {
      if (filter.$and) return Promise.resolve(counts.liveNow ?? 0);
      switch (filter.status) {
        case ClassStatus.SCHEDULED:
          return Promise.resolve(counts.upcoming ?? 0);
        case ClassStatus.PENDING_APPROVAL:
          return Promise.resolve(counts.pending ?? 0);
        case ClassStatus.COMPLETED:
          return Promise.resolve(counts.completed ?? 0);
        case ClassStatus.CANCELLED:
          return Promise.resolve(counts.cancelled ?? 0);
        case ClassStatus.MISSED:
          return Promise.resolve(counts.missed ?? 0);
        default:
          return Promise.resolve(0);
      }
    }),
    find: jest.fn(() => findChain(fx.nextClasses ?? [])),
    aggregate: jest.fn((pipeline: any[]) => {
      const unwind = pipeline.find((s) => s.$unwind);
      if (unwind) {
        // Actually run the dedupe the service asked for, against the rosters,
        // so a pipeline that unwound or grouped on the wrong path fails here
        // instead of quietly returning a plausible number.
        const path = String(unwind.$unwind).slice(1);
        const groupKey = String(
          pipeline.find((s) => s.$group).$group._id,
        ).slice(1);
        const seen = new Set<string>();
        for (const cls of fx.classRosters ?? []) {
          for (const value of (cls as any)[path] ?? []) {
            seen.add(String({ ...cls, [path]: value }[groupKey]));
          }
        }
        return Promise.resolve(seen.size ? [{ total: seen.size }] : []);
      }
      if (pipeline[0]?.$match?.visibility === 'group') {
        return Promise.resolve(fx.seats ? [fx.seats] : []);
      }
      if (pipeline[1]?.$group?.ms) {
        return Promise.resolve(
          fx.scheduledMs === undefined ? [] : [{ ms: fx.scheduledMs }],
        );
      }
      if (pipeline[1]?.$group?._id?.$dateToString) {
        return Promise.resolve(fx.monthly ?? []);
      }
      return Promise.resolve([]);
    }),
  };

  const notificationModel: any = {
    countDocuments: jest.fn(() => Promise.resolve(fx.notifications ?? 0)),
  };

  const conversationModel: any = {
    find: jest.fn((filter: any) =>
      findChain(
        (fx.conversations ?? []).filter((c) => matchesConversation(c, filter)),
      ),
    ),
  };

  const messageModel: any = {
    countDocuments: jest.fn((filter: any) =>
      Promise.resolve(
        (fx.messages ?? []).filter((m) => matchesMessage(m, filter)).length,
      ),
    ),
  };

  const tutorMaterialModel: any = {
    countDocuments: jest.fn(() => Promise.resolve(fx.materialsPublished ?? 0)),
  };

  const materialPurchaseModel: any = {
    countDocuments: jest.fn(() => Promise.resolve(fx.materialsOwned ?? 0)),
  };

  const payments: any = {
    sellerBalance: jest.fn(() =>
      Promise.resolve(
        fx.balance ?? {
          grossMinor: 0,
          commissionMinor: 0,
          netMinor: 0,
          owedMinor: 0,
          paymentCount: 0,
        },
      ),
    ),
  };

  const settings: any = {
    currency: jest.fn(() => Promise.resolve(fx.currency ?? 'USD')),
  };

  const service = new DashboardService(
    classSessionModel,
    notificationModel,
    conversationModel,
    messageModel,
    tutorMaterialModel,
    materialPurchaseModel,
    payments,
    settings,
  );

  return {
    service,
    classSessionModel,
    notificationModel,
    conversationModel,
    messageModel,
    materialPurchaseModel,
    payments,
    settings,
  };
}

const student = (kycData: Record<string, unknown> = {}) =>
  ({
    _id: oid(STUDENT_ID),
    role: UserRole.STUDENT,
    status: UserStatus.ACTIVE,
    onboardingStep: OnboardingStep.SIGNED_UP,
    kycData,
  }) as any;

const tutor = (over: Record<string, unknown> = {}) =>
  ({
    _id: oid(TUTOR_ID),
    role: UserRole.TUTOR,
    status: UserStatus.ACTIVE,
    onboardingStep: OnboardingStep.KYC_COMPLETED,
    kycData: {},
    ...over,
  }) as any;

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});
afterAll(() => {
  jest.useRealTimers();
});

describe('DashboardService — role branching', () => {
  it('returns student-shaped data for a student', async () => {
    const { service } = build({
      counts: {
        liveNow: 1,
        upcoming: 4,
        pending: 2,
        completed: 7,
        cancelled: 1,
      },
      scheduledMs: 7 * 60 * 60 * 1000,
      materialsOwned: 3,
      notifications: 5,
      nextClasses: [
        {
          _id: oid('5ddddddddddddddddddddd14'),
          title: 'Algebra II',
          startTime: new Date('2026-09-21T09:00:00.000Z'),
          endTime: new Date('2026-09-21T10:00:00.000Z'),
          status: ClassStatus.SCHEDULED,
          liveSession: { status: LiveStatus.IDLE },
          tutorId: {
            _id: oid(TUTOR_ID),
            firstName: 'Ada',
            lastName: 'Lovelace',
          },
        },
      ],
    });

    const result: any = await service.getSummary(
      student({ avatar: 'https://x/a.png', phone: '+1 212 555 1234' }),
    );

    expect(result.role).toBe('student');
    expect(result.classes).toEqual({
      liveNow: 1,
      upcoming: 4,
      pendingApproval: 2,
      completed: 7,
      cancelled: 1,
    });
    expect(result.scheduledMinutes).toBe(420);
    expect(result.materialsOwned).toBe(3);
    expect(result.unread.notifications).toBe(5);
    expect(result.nextClasses).toHaveLength(1);
    expect(result.nextClasses[0]).toMatchObject({
      title: 'Algebra II',
      status: ClassStatus.SCHEDULED,
      liveStatus: 'idle',
      tutor: { firstName: 'Ada', lastName: 'Lovelace' },
    });
    // 2 of the 5 student profile slots are filled.
    expect(result.profileCompletenessPercent).toBe(40);
    // Nothing tutor-only leaks into a student payload.
    expect(result.earnings).toBeUndefined();
    expect(result.activityByMonth).toBeUndefined();
  });

  it('returns tutor-shaped data for a tutor', async () => {
    const { service } = build({
      counts: {
        liveNow: 0,
        upcoming: 2,
        pending: 3,
        completed: 11,
        missed: 1,
      },
      seats: { sold: 9, capacity: 20 },
      classRosters: [{ students: [oid(STUDENT_ID), oid(OTHER_ID)] }],
      materialsPublished: 4,
      balance: {
        grossMinor: 50000,
        commissionMinor: 5000,
        netMinor: 45000,
        owedMinor: 45000,
        paymentCount: 2,
      },
      currency: 'COP',
      nextClasses: [
        {
          _id: oid('5ddddddddddddddddddddd15'),
          title: 'Group Calculus',
          startTime: new Date('2026-09-20T13:00:00.000Z'),
          endTime: new Date('2026-09-20T14:00:00.000Z'),
          status: ClassStatus.ONGOING,
          liveSession: { status: LiveStatus.LIVE },
          students: [oid(STUDENT_ID), oid(OTHER_ID)],
          maxStudents: 10,
        },
      ],
    });

    const result: any = await service.getSummary(tutor());

    expect(result.role).toBe('tutor');
    expect(result.classes).toEqual({
      liveNow: 0,
      upcoming: 2,
      pendingRequests: 3,
      completed: 11,
      missed: 1,
    });
    expect(result.seats).toEqual({ sold: 9, capacity: 20 });
    expect(result.students.distinctTotal).toBe(2);
    expect(result.earnings).toEqual({
      grossMinor: 50000,
      commissionMinor: 5000,
      netMinor: 45000,
      owedMinor: 45000,
      paymentCount: 2,
      currency: 'COP',
    });
    expect(result.materialsPublished).toBe(4);
    expect(result.onboarding).toEqual({
      step: OnboardingStep.KYC_COMPLETED,
      status: UserStatus.ACTIVE,
      // Mirrors `classes.missed`, against the real auto-suspend threshold.
      strikes: { missed: 1, limit: 3 },
    });
    expect(result.nextClasses[0]).toMatchObject({
      title: 'Group Calculus',
      liveStatus: 'live',
      enrolled: 2,
      maxStudents: 10,
    });
    // Nothing student-only leaks into a tutor payload.
    expect(result.scheduledMinutes).toBeUndefined();
    expect(result.materialsOwned).toBeUndefined();
  });

  it('refuses an admin rather than inventing a role-neutral summary', async () => {
    const { service } = build();
    await expect(
      service.getSummary({
        _id: oid(OTHER_ID),
        role: UserRole.ADMIN,
        kycData: {},
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('distinct student count', () => {
  it('counts a student enrolled in three classes once', async () => {
    const { service } = build({
      classRosters: [
        { students: [oid(STUDENT_ID)] },
        { students: [oid(STUDENT_ID)] },
        { students: [oid(STUDENT_ID)] },
      ],
    });

    const result: any = await service.getSummary(tutor());
    expect(result.students.distinctTotal).toBe(1);
  });

  it('adds up genuinely different students across classes', async () => {
    const { service } = build({
      classRosters: [
        { students: [oid(STUDENT_ID), oid(OTHER_ID)] },
        { students: [oid(STUDENT_ID)] },
        { students: [oid(TUTOR_ID)] },
      ],
    });

    const result: any = await service.getSummary(tutor());
    expect(result.students.distinctTotal).toBe(3);
  });

  it('dedupes in MongoDB, not in Node', async () => {
    const { service, classSessionModel } = build({ classRosters: [] });
    await service.getSummary(tutor());

    const pipelines = classSessionModel.aggregate.mock.calls.map(
      (c: any[]) => c[0],
    );
    const distinct = pipelines.find((p: any[]) =>
      p.some((stage) => stage.$unwind === '$students'),
    );
    expect(distinct).toBeDefined();
    expect(distinct).toEqual(
      expect.arrayContaining([{ $group: { _id: '$students' } }]),
    );
  });
});

describe('activityByMonth', () => {
  it('returns exactly six zero-filled buckets when nothing was completed', async () => {
    const { service } = build({ monthly: [] });
    const result: any = await service.getSummary(tutor());

    expect(result.activityByMonth).toEqual([
      { month: '2026-04', completed: 0 },
      { month: '2026-05', completed: 0 },
      { month: '2026-06', completed: 0 },
      { month: '2026-07', completed: 0 },
      { month: '2026-08', completed: 0 },
      { month: '2026-09', completed: 0 },
    ]);
  });

  it('places each month on its bucket and zero-fills the quiet ones', async () => {
    const { service } = build({
      monthly: [
        { _id: '2026-09', count: 2 },
        { _id: '2026-06', count: 5 },
      ],
    });

    const result: any = await service.getSummary(tutor());

    expect(result.activityByMonth).toHaveLength(6);
    expect(result.activityByMonth.map((b: any) => b.completed)).toEqual([
      0, 0, 5, 0, 0, 2,
    ]);
    // Oldest first, ending on the current month.
    expect(result.activityByMonth[0].month).toBe('2026-04');
    expect(result.activityByMonth[5].month).toBe('2026-09');
  });

  it('ignores a month outside the window rather than growing the series', async () => {
    const { service } = build({
      monthly: [
        { _id: '2025-12', count: 9 },
        { _id: '2026-05', count: 1 },
      ],
    });

    const result: any = await service.getSummary(tutor());
    expect(result.activityByMonth).toHaveLength(6);
    expect(
      result.activityByMonth.reduce((n: number, b: any) => n + b.completed, 0),
    ).toBe(1);
  });
});

describe('an account with no data', () => {
  it('returns zeros throughout for a student', async () => {
    const { service } = build();
    const result: any = await service.getSummary(student());

    expect(result).toEqual({
      role: 'student',
      classes: {
        liveNow: 0,
        upcoming: 0,
        pendingApproval: 0,
        completed: 0,
        cancelled: 0,
      },
      nextClasses: [],
      scheduledMinutes: 0,
      unread: { notifications: 0, messages: 0 },
      materialsOwned: 0,
      profileCompletenessPercent: 0,
    });
  });

  it('returns zeros throughout for a tutor', async () => {
    const { service } = build();
    const result: any = await service.getSummary(tutor());

    expect(result.classes).toEqual({
      liveNow: 0,
      upcoming: 0,
      pendingRequests: 0,
      completed: 0,
      missed: 0,
    });
    expect(result.nextClasses).toEqual([]);
    expect(result.seats).toEqual({ sold: 0, capacity: 0 });
    expect(result.students).toEqual({ distinctTotal: 0 });
    expect(result.earnings).toEqual({
      grossMinor: 0,
      commissionMinor: 0,
      netMinor: 0,
      owedMinor: 0,
      paymentCount: 0,
      currency: 'USD',
    });
    expect(result.unread).toEqual({ notifications: 0, messages: 0 });
    expect(result.materialsPublished).toBe(0);
    expect(result.profileCompletenessPercent).toBe(0);
    expect(result.activityByMonth).toHaveLength(6);
  });

  it('does not query messages at all when the user is in no conversation', async () => {
    const { service, messageModel } = build({ conversations: [] });
    await service.getSummary(student());
    expect(messageModel.countDocuments).not.toHaveBeenCalled();
  });
});

describe('unread messages', () => {
  const DM = oid('5eeeeeeeeeeeeeeeeeeeee16');
  const CLASS_ROOM = oid('5fffffffffffffffffffff17');

  const fixture = {
    conversations: [
      {
        _id: DM,
        participants: [oid(STUDENT_ID), oid(TUTOR_ID)],
        type: 'dm',
      },
      {
        _id: CLASS_ROOM,
        participants: [oid(STUDENT_ID), oid(TUTOR_ID)],
        type: 'class',
      },
    ],
    messages: [
      // Unread, from the other person, in the private chat — the only one
      // that should be counted.
      {
        conversationId: DM,
        senderId: oid(TUTOR_ID),
        isRead: false,
      },
      // Sent by the viewer: never unread to them.
      {
        conversationId: DM,
        senderId: oid(STUDENT_ID),
        isRead: false,
      },
      // Already read.
      {
        conversationId: DM,
        senderId: oid(TUTOR_ID),
        isRead: true,
      },
      // Class Q&A room — excluded from the chat list, so excluded here.
      {
        conversationId: CLASS_ROOM,
        senderId: oid(TUTOR_ID),
        isRead: false,
      },
    ],
  };

  it("excludes the viewer's own messages and class Q&A rooms", async () => {
    const { service } = build(fixture);
    const result: any = await service.getSummary(student());
    expect(result.unread.messages).toBe(1);
  });

  it('asks for a global total rather than a page of conversations', async () => {
    const { service, conversationModel, messageModel } = build(fixture);
    await service.getSummary(student());

    const [conversationFilter] = conversationModel.find.mock.calls[0];
    expect(conversationFilter.type).toEqual({ $ne: 'class' });

    const [messageFilter] = messageModel.countDocuments.mock.calls[0];
    expect(messageFilter.isRead).toBe(false);
    expect(messageFilter.senderId.$ne).toBeDefined();
    // Every conversation the user is in, not a slice of them.
    expect(messageFilter.conversationId.$in).toHaveLength(1);
  });

  it('counts unread notifications for the signed-in user only', async () => {
    const { service, notificationModel } = build({ notifications: 12 });
    const result: any = await service.getSummary(student());

    expect(result.unread.notifications).toBe(12);
    const [filter] = notificationModel.countDocuments.mock.calls[0];
    expect(filter.read).toBe(false);
    expect(String(filter.userId)).toBe(STUDENT_ID);
  });
});

describe('profileCompletenessPercent', () => {
  it('is 100 when every scored student field is set', async () => {
    const { service } = build();
    const result: any = await service.getSummary(
      student({
        avatar: 'https://x/a.png',
        phone: '+1 212 555 1234',
        bio: 'Hello',
        dob: '2000-01-16',
        country: 'Colombia',
      }),
    );
    expect(result.profileCompletenessPercent).toBe(100);
  });

  it('accepts either spelling of the duplicated tutor keys', async () => {
    const { service } = build();

    // Written by tutor onboarding: photoUrl / pricePerHour / aboutMe.
    const viaOnboarding: any = await service.getSummary(
      tutor({
        kycData: {
          title: 'Senior Maths Tutor',
          aboutMe: 'Ten years of teaching',
          photoUrl: 'https://x/a.png',
          pricePerHour: 40,
          specialties: ['Algebra'],
          education: 'BSc',
          experience: '10 years',
        },
      }),
    );

    // Written by the profile editor: avatar / hourlyRate / bio.
    const viaProfileEditor: any = await service.getSummary(
      tutor({
        kycData: {
          title: 'Senior Maths Tutor',
          bio: 'Ten years of teaching',
          avatar: 'https://x/a.png',
          hourlyRate: 40,
          specialties: ['Algebra'],
          education: [{ degree: 'BSc' }],
          experience: [{ role: 'Tutor' }],
        },
      }),
    );

    expect(viaOnboarding.profileCompletenessPercent).toBe(100);
    expect(viaProfileEditor.profileCompletenessPercent).toBe(100);
  });

  it('does not credit blank strings, empty arrays or a zero price', async () => {
    const { service } = build();
    const result: any = await service.getSummary(
      tutor({
        kycData: {
          title: '   ',
          bio: '',
          avatar: null,
          hourlyRate: 0,
          specialties: [],
          education: [],
          experience: [],
        },
      }),
    );
    expect(result.profileCompletenessPercent).toBe(0);
  });
});
