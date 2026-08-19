import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ClassesService } from './classes.service';
import { ClassStatus, LiveStatus } from '../schemas/class.schema';

/**
 * Authorization + state transitions for the class lifecycle the feature
 * describes: tutor starts, students join, tutor ends, admin/owner deletes.
 */
const TUTOR = 'tutor-1';
const OTHER_TUTOR = 'tutor-2';
const STUDENT = 'student-1';
const OUTSIDER = 'student-9';

function makeService() {
  const findByIdAndDelete = jest
    .fn()
    .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
  const classSessionModel: any = { findByIdAndDelete };
  const vimeoService: any = {
    deleteLiveEvent: jest.fn().mockResolvedValue({}),
  };
  const chatService: any = { addParticipant: jest.fn().mockResolvedValue({}) };
  const chatGateway: any = {
    emitToConversation: jest.fn(),
    emitToUsers: jest.fn(),
  };
  // startLive alerts enrolled students that the class has begun, so the
  // notifications collaborator has to be real enough to be called.
  const notificationsService: any = { create: jest.fn().mockResolvedValue({}) };
  const service = new ClassesService(
    classSessionModel,
    {} as any,
    vimeoService,
    chatService,
    chatGateway,
    notificationsService,
  );
  return {
    service,
    findByIdAndDelete,
    vimeoService,
    chatGateway,
    notificationsService,
  };
}

const fakeClass = (over: any = {}) => ({
  _id: 'class-1',
  tutorId: { _id: TUTOR, toString: () => TUTOR },
  students: [STUDENT],
  title: 'Algebra',
  status: ClassStatus.SCHEDULED,
  startTime: new Date(),
  endTime: new Date(),
  liveSession: {
    vimeoEventId: 'vimeo-1',
    embedUrl: 'https://embed',
    conversationId: null,
    status: LiveStatus.IDLE,
    startedAt: null,
    endedAt: null,
  },
  save: jest.fn().mockResolvedValue(true),
  ...over,
});

describe('startLive (tutor starts the class)', () => {
  it('owner with a set-up session goes ONGOING/LIVE and stamps startedAt', async () => {
    const { service } = makeService();
    const cls = fakeClass();
    jest.spyOn(service, 'findOne').mockResolvedValue(cls as any);
    await service.startLive('class-1', TUTOR);
    expect(cls.status).toBe(ClassStatus.ONGOING);
    expect(cls.liveSession.status).toBe(LiveStatus.LIVE);
    expect(cls.liveSession.startedAt).toBeInstanceOf(Date);
    expect(cls.save).toHaveBeenCalled();
  });

  it('a different tutor cannot start it (403)', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue(fakeClass() as any);
    await expect(
      service.startLive('class-1', OTHER_TUTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cannot start before the live session is set up (400)', async () => {
    const { service } = makeService();
    const cls = fakeClass({ liveSession: { vimeoEventId: null } });
    jest.spyOn(service, 'findOne').mockResolvedValue(cls as any);
    await expect(service.startLive('class-1', TUTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('alerts enrolled students that the class is live', async () => {
    const { service, notificationsService, chatGateway } = makeService();
    const cls = fakeClass();
    jest.spyOn(service, 'findOne').mockResolvedValue(cls as any);

    await service.startLive('class-1', TUTOR);

    // Persisted, so a student who logs in mid-class still sees it, and pushed
    // over the app-wide channel so students not on the live page are reached.
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: STUDENT,
        actionPayload: expect.objectContaining({ kind: 'class_live' }),
      }),
    );
    expect(chatGateway.emitToUsers).toHaveBeenCalledWith(
      [STUDENT],
      'newNotification',
      expect.objectContaining({
        actionPayload: expect.objectContaining({ kind: 'class_live' }),
      }),
    );
  });

  it('does not re-alert when an already-live class is started again', async () => {
    const { service, notificationsService } = makeService();
    // A double-click on "Go Live" must not notify every student twice.
    const cls = fakeClass({
      liveSession: {
        vimeoEventId: 'vimeo-1',
        embedUrl: 'https://embed',
        conversationId: null,
        status: LiveStatus.LIVE,
        startedAt: new Date(),
        endedAt: null,
      },
    });
    jest.spyOn(service, 'findOne').mockResolvedValue(cls as any);

    await service.startLive('class-1', TUTOR);

    expect(notificationsService.create).not.toHaveBeenCalled();
  });
});

describe('getWatchInfo (student opens the class)', () => {
  it('an enrolled student gets the live info', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue(fakeClass() as any);
    const info = await service.getWatchInfo('class-1', STUDENT, 'student');
    expect(info.classId).toBe('class-1');
    expect(info.live.embedUrl).toBe('https://embed');
  });

  it('a non-enrolled student is refused (403)', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue(fakeClass() as any);
    await expect(
      service.getWatchInfo('class-1', OUTSIDER, 'student'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an admin can watch any class even if not enrolled', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue(fakeClass() as any);
    const info = await service.getWatchInfo('class-1', 'admin-1', 'admin');
    expect(info.classId).toBe('class-1');
  });

  it('the owning tutor can watch their own class', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue(fakeClass() as any);
    const info = await service.getWatchInfo('class-1', TUTOR, 'tutor');
    expect(info.classId).toBe('class-1');
  });
});

describe('endLive (tutor ends the class)', () => {
  it('owner ends → COMPLETED / ENDED', async () => {
    const { service } = makeService();
    const cls = fakeClass({ status: ClassStatus.ONGOING });
    jest.spyOn(service, 'findOne').mockResolvedValue(cls as any);
    await service.endLive('class-1', TUTOR);
    expect(cls.status).toBe(ClassStatus.COMPLETED);
    expect(cls.liveSession.status).toBe(LiveStatus.ENDED);
  });

  it('a non-owner cannot end it (403)', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue(fakeClass() as any);
    await expect(
      service.endLive('class-1', OTHER_TUTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('remove (admin/owner deletes the class)', () => {
  it('an admin can delete any class and tears down the Vimeo event', async () => {
    const { service, findByIdAndDelete, vimeoService } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue(fakeClass() as any);
    await service.remove('class-1', 'admin-1', true);
    expect(vimeoService.deleteLiveEvent).toHaveBeenCalledWith('vimeo-1');
    expect(findByIdAndDelete).toHaveBeenCalledWith('class-1');
  });

  it('the owning tutor can delete their own class', async () => {
    const { service, findByIdAndDelete } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue(fakeClass() as any);
    await service.remove('class-1', TUTOR, false);
    expect(findByIdAndDelete).toHaveBeenCalledWith('class-1');
  });

  it('a different tutor cannot delete it', async () => {
    const { service, findByIdAndDelete } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue(fakeClass() as any);
    await expect(
      service.remove('class-1', OTHER_TUTOR, false),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findByIdAndDelete).not.toHaveBeenCalled();
  });
});

describe('setupLive (provisioning guardrails)', () => {
  it('refuses to set up a cancelled class (400)', async () => {
    const { service } = makeService();
    const cls = fakeClass({ status: ClassStatus.CANCELLED });
    jest.spyOn(service, 'findOne').mockResolvedValue(cls as any);
    await expect(service.setupLive('class-1', TUTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a non-owner cannot set up the live session (403)', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue(fakeClass() as any);
    await expect(
      service.setupLive('class-1', OTHER_TUTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
