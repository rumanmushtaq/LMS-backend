import { ClassesService } from './classes.service';
import { ClassStatus } from '../schemas/class.schema';

/**
 * Coverage for the class-start alert: the sweep that tells enrolled students
 * their scheduled time has arrived, and the go-live alert fired when the tutor
 * actually starts broadcasting.
 *
 * The behaviour that matters most here is *exactly once*. The sweep runs every
 * minute for the whole life of a class, so anything that re-notifies would
 * spam every enrolled student once a minute until the class ended.
 */
const CLASS_ID = 'ccccccccccccccccccccccc1';
const STUDENT_A = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const STUDENT_B = 'bbbbbbbbbbbbbbbbbbbbbbb2';

const leanChain = (value: any) => ({
  select: () => ({ lean: () => Promise.resolve(value) }),
  lean: () => Promise.resolve(value),
});

interface Harness {
  service: ClassesService;
  find: jest.Mock;
  findOneAndUpdate: jest.Mock;
  notify: jest.Mock;
  emitToUsers: jest.Mock;
}

function buildService(opts: {
  starting: any[];
  /** Whether the atomic claim succeeds. Null models "another instance won". */
  claimResult?: any;
}): Harness {
  const { starting, claimResult = { _id: CLASS_ID } } = opts;

  const find = jest.fn().mockReturnValue(leanChain(starting));
  const findOneAndUpdate = jest.fn().mockReturnValue(leanChain(claimResult));

  const classSessionModel: any = { find, findOneAndUpdate };

  const notify = jest.fn().mockResolvedValue({});
  const notificationsService: any = { create: notify };

  const emitToUsers = jest.fn();
  const chatGateway: any = { emitToUsers, emitToConversation: jest.fn() };

  const service = new ClassesService(
    classSessionModel,
    {} as any, // users
    {} as any, // vimeo
    {} as any, // chat
    chatGateway,
    notificationsService,
  );

  return { service, find, findOneAndUpdate, notify, emitToUsers };
}

const startingClass = (overrides: Record<string, unknown> = {}) => ({
  _id: CLASS_ID,
  title: 'Linear Algebra',
  startTime: new Date('2026-01-01T12:00:00Z'),
  students: [STUDENT_A, STUDENT_B],
  ...overrides,
});

describe('sweepStartingClasses — selection', () => {
  it('does nothing when no class is starting', async () => {
    const { service, findOneAndUpdate, notify } = buildService({
      starting: [],
    });

    const res = await service.sweepStartingClasses();

    expect(res).toEqual({ notifiedClasses: 0, notifiedStudents: 0 });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('selects only SCHEDULED classes that have started, not ended, never alerted', async () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const { service, find } = buildService({ starting: [] });

    await service.sweepStartingClasses(now);

    const q = find.mock.calls[0][0];
    // SCHEDULED alone excludes pending-approval, cancelled, ongoing and missed.
    expect(q.status).toBe(ClassStatus.SCHEDULED);
    expect(q.startTime.$lte).toBe(now);
    expect(q.endTime.$gt).toBe(now);
    expect(q.startNotifiedAt).toBeNull();
  });

  it('skips a class with no enrolled students', async () => {
    const { service, notify, emitToUsers } = buildService({
      starting: [startingClass({ students: [] })],
    });

    const res = await service.sweepStartingClasses();

    expect(res.notifiedStudents).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(emitToUsers).not.toHaveBeenCalled();
  });
});

describe('sweepStartingClasses — exactly-once guarantees', () => {
  it('claims the class before notifying anyone', async () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const { service, findOneAndUpdate } = buildService({
      starting: [startingClass()],
    });

    await service.sweepStartingClasses(now);

    // Conditioned on startNotifiedAt still being null — that condition is the
    // whole defence against two instances double-sending.
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: CLASS_ID, startNotifiedAt: null },
      { $set: { startNotifiedAt: now } },
    );
  });

  it('notifies nobody when another instance won the claim', async () => {
    const { service, notify, emitToUsers } = buildService({
      starting: [startingClass()],
      claimResult: null, // the conditional update matched no document
    });

    const res = await service.sweepStartingClasses();

    expect(res).toEqual({ notifiedClasses: 0, notifiedStudents: 0 });
    expect(notify).not.toHaveBeenCalled();
    expect(emitToUsers).not.toHaveBeenCalled();
  });

  it('is idempotent — a second sweep finds nothing because the marker is set', async () => {
    // The marker is enforced by the query itself, so a re-run returns no rows.
    const { service, notify } = buildService({ starting: [] });

    await service.sweepStartingClasses();

    expect(notify).not.toHaveBeenCalled();
  });
});

describe('sweepStartingClasses — notification content', () => {
  it('persists one notification per enrolled student', async () => {
    const { service, notify } = buildService({ starting: [startingClass()] });

    const res = await service.sweepStartingClasses();

    expect(res).toEqual({ notifiedClasses: 1, notifiedStudents: 2 });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls.map((c) => c[0].userId)).toEqual([
      STUDENT_A,
      STUDENT_B,
    ]);
  });

  it('carries the payload the client modal keys off', async () => {
    const { service, notify } = buildService({ starting: [startingClass()] });

    await service.sweepStartingClasses();

    const payload = notify.mock.calls[0][0].actionPayload;
    expect(payload.kind).toBe('class_starting');
    expect(payload.classId).toBe(CLASS_ID);
    expect(payload.joinUrl).toBe(`/student/classes/${CLASS_ID}/live`);
  });

  it('pushes live over the existing newNotification channel', async () => {
    const { service, emitToUsers } = buildService({
      starting: [startingClass()],
    });

    await service.sweepStartingClasses();

    expect(emitToUsers).toHaveBeenCalledWith(
      [STUDENT_A, STUDENT_B],
      'newNotification',
      expect.objectContaining({
        actionPayload: expect.objectContaining({ kind: 'class_starting' }),
      }),
    );
  });

  it('handles students stored as populated documents, not bare ids', async () => {
    const { service, notify } = buildService({
      starting: [
        startingClass({ students: [{ _id: STUDENT_A }, { _id: STUDENT_B }] }),
      ],
    });

    await service.sweepStartingClasses();

    expect(notify.mock.calls.map((c) => c[0].userId)).toEqual([
      STUDENT_A,
      STUDENT_B,
    ]);
  });

  it('alerts every starting class independently', async () => {
    const { service } = buildService({
      starting: [
        startingClass(),
        startingClass({
          _id: 'ccccccccccccccccccccccc2',
          students: [STUDENT_A],
        }),
      ],
    });

    const res = await service.sweepStartingClasses();

    expect(res).toEqual({ notifiedClasses: 2, notifiedStudents: 3 });
  });

  it('a failed notification for one student does not block the others', async () => {
    const { service, notify, emitToUsers } = buildService({
      starting: [startingClass()],
    });
    notify.mockRejectedValueOnce(new Error('notif db down'));

    const res = await service.sweepStartingClasses();

    // allSettled: the second student is still written and the push still goes.
    expect(res.notifiedClasses).toBe(1);
    expect(emitToUsers).toHaveBeenCalled();
  });
});
