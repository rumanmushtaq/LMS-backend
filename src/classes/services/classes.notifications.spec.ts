import { ClassesService } from './classes.service';
import { ClassStatus } from '../schemas/class.schema';

/**
 * Regression tests for the missing notifications: a class request must alert
 * the tutor, and approve/decline must alert the student — each persisted (bell)
 * and pushed over the socket (live).
 */
const TUTOR = '5aaaaaaaaaaaaaaaaaaaaaa1';
const STUDENT = '5bbbbbbbbbbbbbbbbbbbbbb2';

function build() {
  const notify = jest.fn().mockResolvedValue({});
  const emitToUsers = jest.fn();
  const saved = { _id: 'class-1' };

  const classSessionModel: any = function () {
    return { save: jest.fn().mockResolvedValue(saved) };
  };
  const userModel: any = {
    findById: jest.fn(() => ({
      select: () => ({
        lean: () =>
          Promise.resolve({
            firstName: 'Sam',
            lastName: 'Student',
            email: 's@x.com',
          }),
      }),
    })),
  };

  const service = new ClassesService(
    classSessionModel,
    userModel,
    {} as any, // vimeo
    {} as any, // chat
    { emitToConversation: jest.fn(), emitToUsers } as any, // gateway
    { create: notify } as any, // notifications
  );
  return { service, notify, emitToUsers };
}

const populatedClass = (over: any = {}) => ({
  _id: 'class-1',
  title: 'Algebra',
  status: ClassStatus.PENDING_APPROVAL,
  tutorId: {
    _id: TUTOR,
    firstName: 'Terry',
    lastName: 'Tutor',
    email: 't@x.com',
    toString: () => TUTOR,
  },
  requestedBy: { _id: STUDENT, firstName: 'Sam', lastName: 'Student' },
  meetingLink: null,
  declineReason: null,
  save: jest.fn().mockResolvedValue(true),
  ...over,
});

describe('requestClass notifications', () => {
  it('notifies the tutor when a student books a class', async () => {
    const { service, notify, emitToUsers } = build();
    await service.requestClass(STUDENT, {
      tutorId: TUTOR,
      title: 'Algebra',
      description: 'help',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
    } as any);

    expect(notify).toHaveBeenCalledTimes(1);
    const note = notify.mock.calls[0][0];
    expect(note.userId).toBe(TUTOR); // the tutor is the recipient
    expect(note.actionPayload.kind).toBe('class_request');
    expect(note.content).toMatch(/Sam Student/);
    // pushed live too
    expect(emitToUsers).toHaveBeenCalledWith(
      [TUTOR],
      'newNotification',
      expect.any(Object),
    );
  });
});

describe('approveClass notifications', () => {
  it('notifies the student when the tutor approves', async () => {
    const { service, notify, emitToUsers } = build();
    jest.spyOn(service, 'findOne').mockResolvedValue(populatedClass() as any);

    await service.approveClass('class-1', TUTOR, {} as any);

    const note = notify.mock.calls[0][0];
    expect(note.userId).toBe(STUDENT); // student recipient
    expect(note.actionPayload.kind).toBe('class_approved');
    expect(note.title).toMatch(/approved/i);
    expect(emitToUsers).toHaveBeenCalledWith(
      [STUDENT],
      'newNotification',
      expect.any(Object),
    );
  });

  it('does not notify when a non-owner tries to approve (throws first)', async () => {
    const { service, notify } = build();
    jest.spyOn(service, 'findOne').mockResolvedValue(populatedClass() as any);
    await expect(
      service.approveClass('class-1', 'someone-else', {} as any),
    ).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('declineClass notifications', () => {
  it('notifies the student with the reason when the tutor declines', async () => {
    const { service, notify, emitToUsers } = build();
    jest.spyOn(service, 'findOne').mockResolvedValue(populatedClass() as any);

    await service.declineClass('class-1', TUTOR, {
      declineReason: 'Schedule clash',
    } as any);

    const note = notify.mock.calls[0][0];
    expect(note.userId).toBe(STUDENT);
    expect(note.actionPayload.kind).toBe('class_declined');
    expect(note.content).toMatch(/Schedule clash/);
    expect(emitToUsers).toHaveBeenCalledWith(
      [STUDENT],
      'newNotification',
      expect.any(Object),
    );
  });

  it('declines cleanly with no reason (still notifies)', async () => {
    const { service, notify } = build();
    jest.spyOn(service, 'findOne').mockResolvedValue(populatedClass() as any);
    await service.declineClass('class-1', TUTOR, {} as any);
    expect(notify.mock.calls[0][0].actionPayload.kind).toBe('class_declined');
  });
});

describe('notification failures never break the class action', () => {
  it('a notification error is swallowed — the request still succeeds', async () => {
    const { service, notify } = build();
    notify.mockRejectedValueOnce(new Error('notif db down'));
    const res = await service.requestClass(STUDENT, {
      tutorId: TUTOR,
      title: 'Algebra',
      description: 'x',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
    } as any);
    expect(res).toBeDefined(); // booking succeeded despite notify failing
  });
});
