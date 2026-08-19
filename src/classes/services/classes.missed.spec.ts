import { ClassesService } from './classes.service';
import { ClassStatus } from '../schemas/class.schema';
import { UserRole, UserStatus } from '../../users/schemas/user.schema';

/**
 * Exhaustive coverage of the missed-class (no-show) detection and the
 * 3-strike auto-suspension it drives.
 */
const TUTOR_A = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const TUTOR_B = 'bbbbbbbbbbbbbbbbbbbbbbb2';

const leanChain = (value: any) => ({
  select: () => ({ lean: () => Promise.resolve(value) }),
});

interface Harness {
  service: ClassesService;
  updateMany: jest.Mock;
  userUpdateOne: jest.Mock;
  notify: jest.Mock;
}

function buildService(opts: {
  overdue: any[];
  /** missed count returned by countDocuments, keyed by tutorId */
  missedCountByTutor?: Record<string, number>;
  /** tutor docs returned by findById, keyed by id */
  tutors?: Record<string, any>;
  admins?: any[];
}): Harness {
  const {
    overdue,
    missedCountByTutor = {},
    tutors = {},
    admins = [{ _id: 'admin-1' }],
  } = opts;

  const updateMany = jest.fn().mockResolvedValue({});
  const countDocuments = jest.fn().mockImplementation((q: any) => {
    const id = q.tutorId?.toString?.() ?? '';
    return Promise.resolve(missedCountByTutor[id] ?? 0);
  });
  const classSessionModel: any = {
    find: jest.fn().mockReturnValue(leanChain(overdue)),
    updateMany,
    countDocuments,
  };

  const userUpdateOne = jest.fn().mockResolvedValue({});
  const userModel: any = {
    findById: jest.fn((id: string) => leanChain(tutors[id] ?? null)),
    updateOne: userUpdateOne,
    find: jest.fn().mockReturnValue(leanChain(admins)),
  };

  const notify = jest.fn().mockResolvedValue({});
  const notificationsService: any = { create: notify };

  const service = new ClassesService(
    classSessionModel,
    userModel,
    {} as any, // vimeo
    {} as any, // chat
    {} as any, // gateway
    notificationsService,
  );
  return { service, updateMany, userUpdateOne, notify };
}

const activeTutor = (id: string) => ({
  _id: id,
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@x.com',
  status: UserStatus.ACTIVE,
  role: UserRole.TUTOR,
});

describe('sweepMissedClasses — detection', () => {
  it('no overdue classes → marks nothing, suspends nobody', async () => {
    const { service, updateMany, notify } = buildService({ overdue: [] });
    const res = await service.sweepMissedClasses();
    expect(res).toEqual({ markedMissed: 0, suspendedTutors: [] });
    expect(updateMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('queries only SCHEDULED classes whose endTime has passed', async () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const { service } = buildService({ overdue: [] });
    await service.sweepMissedClasses(now);
    const findArg = ((service as any).classSessionModel.find as jest.Mock).mock
      .calls[0][0];
    expect(findArg.status).toBe(ClassStatus.SCHEDULED);
    expect(findArg.endTime.$lt).toBe(now);
  });

  it('marks overdue classes MISSED and stamps missedAt, filtered to still-SCHEDULED (idempotent)', async () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const { service, updateMany } = buildService({
      overdue: [
        { _id: 'c1', tutorId: TUTOR_A, title: 'Algebra', students: [] },
      ],
      missedCountByTutor: { [TUTOR_A]: 1 },
    });
    await service.sweepMissedClasses(now);
    const [filter, update] = updateMany.mock.calls[0];
    expect(filter.status).toBe(ClassStatus.SCHEDULED); // won't re-mark a race
    expect(filter._id.$in).toEqual(['c1']);
    expect(update.status).toBe(ClassStatus.MISSED);
    expect(update.missedAt).toBe(now);
  });

  it('notifies every enrolled student their class was missed', async () => {
    const { service, notify } = buildService({
      overdue: [
        {
          _id: 'c1',
          tutorId: TUTOR_A,
          title: 'Algebra',
          students: ['s1', 's2'],
        },
      ],
      missedCountByTutor: { [TUTOR_A]: 1 },
    });
    await service.sweepMissedClasses();
    const studentNotes = notify.mock.calls.filter(
      (c) => c[0].actionPayload?.kind === 'class_missed',
    );
    expect(studentNotes.map((c) => c[0].userId).sort()).toEqual(['s1', 's2']);
  });

  it('a class with no students still counts, just no student notifications', async () => {
    const { service, updateMany, notify } = buildService({
      overdue: [{ _id: 'c1', tutorId: TUTOR_A, title: 'Solo', students: [] }],
      missedCountByTutor: { [TUTOR_A]: 1 },
    });
    const res = await service.sweepMissedClasses();
    expect(res.markedMissed).toBe(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled(); // no students, tutor under limit
  });
});

describe('sweepMissedClasses — 3-strike auto-suspension', () => {
  it('below the limit (2 misses) → does not suspend', async () => {
    const { service, userUpdateOne, notify } = buildService({
      overdue: [{ _id: 'c1', tutorId: TUTOR_A, title: 'T', students: [] }],
      missedCountByTutor: { [TUTOR_A]: 2 },
      tutors: { [TUTOR_A]: activeTutor(TUTOR_A) },
    });
    const res = await service.sweepMissedClasses();
    expect(res.suspendedTutors).toEqual([]);
    expect(userUpdateOne).not.toHaveBeenCalled();
  });

  it('at the limit (3 misses) → suspends the tutor and alerts admins with the reason', async () => {
    const { service, userUpdateOne, notify } = buildService({
      overdue: [{ _id: 'c3', tutorId: TUTOR_A, title: 'T', students: [] }],
      missedCountByTutor: { [TUTOR_A]: 3 },
      tutors: { [TUTOR_A]: activeTutor(TUTOR_A) },
      admins: [{ _id: 'admin-1' }, { _id: 'admin-2' }],
    });
    const res = await service.sweepMissedClasses();
    expect(res.suspendedTutors).toEqual([TUTOR_A]);
    expect(userUpdateOne).toHaveBeenCalledWith(
      { _id: TUTOR_A, role: UserRole.TUTOR },
      { status: UserStatus.SUSPENDED },
    );
    const adminAlerts = notify.mock.calls.filter(
      (c) => c[0].actionPayload?.kind === 'tutor_auto_suspended',
    );
    expect(adminAlerts).toHaveLength(2); // one per admin
    expect(adminAlerts[0][0].content).toMatch(/missed 3 scheduled classes/i);
    expect(adminAlerts[0][0].actionPayload.reason).toBe('missed_classes');
  });

  it('an already-suspended tutor is not re-suspended or re-alerted (transition only)', async () => {
    const suspended = { ...activeTutor(TUTOR_A), status: UserStatus.SUSPENDED };
    const { service, userUpdateOne, notify } = buildService({
      overdue: [{ _id: 'c4', tutorId: TUTOR_A, title: 'T', students: [] }],
      missedCountByTutor: { [TUTOR_A]: 4 },
      tutors: { [TUTOR_A]: suspended },
    });
    const res = await service.sweepMissedClasses();
    expect(res.suspendedTutors).toEqual([]);
    expect(userUpdateOne).not.toHaveBeenCalled();
    expect(
      notify.mock.calls.filter(
        (c) => c[0].actionPayload?.kind === 'tutor_auto_suspended',
      ),
    ).toHaveLength(0);
  });

  it('a user whose role is no longer tutor is not suspended', async () => {
    const notTutor = { ...activeTutor(TUTOR_A), role: UserRole.STUDENT };
    const { service, userUpdateOne } = buildService({
      overdue: [{ _id: 'c1', tutorId: TUTOR_A, title: 'T', students: [] }],
      missedCountByTutor: { [TUTOR_A]: 5 },
      tutors: { [TUTOR_A]: notTutor },
    });
    const res = await service.sweepMissedClasses();
    expect(res.suspendedTutors).toEqual([]);
    expect(userUpdateOne).not.toHaveBeenCalled();
  });

  it('a missing tutor record is skipped safely', async () => {
    const { service, userUpdateOne } = buildService({
      overdue: [{ _id: 'c1', tutorId: TUTOR_A, title: 'T', students: [] }],
      missedCountByTutor: { [TUTOR_A]: 3 },
      tutors: {}, // findById → null
    });
    const res = await service.sweepMissedClasses();
    expect(res.suspendedTutors).toEqual([]);
    expect(userUpdateOne).not.toHaveBeenCalled();
  });

  it('multiple overdue classes for one tutor in a sweep → suspended exactly once', async () => {
    const { service, userUpdateOne } = buildService({
      overdue: [
        { _id: 'c1', tutorId: TUTOR_A, title: 'A', students: [] },
        { _id: 'c2', tutorId: TUTOR_A, title: 'B', students: [] },
        { _id: 'c3', tutorId: TUTOR_A, title: 'C', students: [] },
      ],
      missedCountByTutor: { [TUTOR_A]: 3 },
      tutors: { [TUTOR_A]: activeTutor(TUTOR_A) },
    });
    const res = await service.sweepMissedClasses();
    expect(res.markedMissed).toBe(3);
    expect(res.suspendedTutors).toEqual([TUTOR_A]);
    expect(userUpdateOne).toHaveBeenCalledTimes(1); // deduped by tutor
  });

  it('evaluates multiple tutors independently in one sweep', async () => {
    const { service, userUpdateOne } = buildService({
      overdue: [
        { _id: 'c1', tutorId: TUTOR_A, title: 'A', students: [] },
        { _id: 'c2', tutorId: TUTOR_B, title: 'B', students: [] },
      ],
      missedCountByTutor: { [TUTOR_A]: 3, [TUTOR_B]: 1 },
      tutors: {
        [TUTOR_A]: activeTutor(TUTOR_A),
        [TUTOR_B]: activeTutor(TUTOR_B),
      },
    });
    const res = await service.sweepMissedClasses();
    expect(res.suspendedTutors).toEqual([TUTOR_A]); // B under limit
    expect(userUpdateOne).toHaveBeenCalledTimes(1);
  });
});

describe('handleMissedClassSweep — cron wrapper never throws', () => {
  it('swallows a sweep error so the scheduler keeps running', async () => {
    const { service } = buildService({ overdue: [] });
    jest
      .spyOn(service, 'sweepMissedClasses')
      .mockRejectedValueOnce(new Error('db down'));
    await expect(service.handleMissedClassSweep()).resolves.not.toThrow();
  });
});
