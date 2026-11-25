import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Types } from 'mongoose';
import {
  ClassSession,
  ClassSessionSchema,
  LiveStatus,
} from '../classes/schemas/class.schema';
import { LiveHlsService } from '../live/live-hls.service';
import {
  TeacherStream,
  TeacherStreamSchema,
} from './schemas/teacher-stream.schema';
import {
  STALE_BROADCAST_MS,
  STUDENTS_ONLY_MESSAGE,
  TeacherStreamsService,
} from './teacher-streams.service';

/**
 * The stream rules that matter are claims about state and roles: one active
 * stream per teacher (a unique index, so a real MongoDB), start/end
 * transitions, and "only students may join" at every door a viewer can use —
 * the watch endpoint and the HLS token. Runs on an in-memory MongoDB, never
 * the real database.
 */

jest.setTimeout(60_000);

let mongod: MongoMemoryServer;
let streamModel: Model<any>;
let classModel: Model<any>;
let userModel: Model<any>;

const TUTOR = new Types.ObjectId().toString();
const OTHER_TUTOR = new Types.ObjectId().toString();
const STUDENT = new Types.ObjectId().toString();
const ADMIN = new Types.ObjectId().toString();

const tutor = { userId: TUTOR, role: 'tutor' };
const otherTutor = { userId: OTHER_TUTOR, role: 'tutor' };
const student = { userId: STUDENT, role: 'student' };
const admin = { userId: ADMIN, role: 'admin' };

let service: TeacherStreamsService;
let liveStreaming: any;
let chatService: any;
let chatGateway: any;
let notifications: any;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  streamModel = mongoose.model(TeacherStream.name, TeacherStreamSchema as any);
  classModel = mongoose.model(ClassSession.name, ClassSessionSchema as any);
  userModel = mongoose.model(
    'User',
    new mongoose.Schema({ firstName: String, lastName: String, email: String }),
  );
  await streamModel.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    streamModel.deleteMany({}),
    classModel.deleteMany({}),
    userModel.deleteMany({}),
  ]);
  await userModel.create({
    _id: new Types.ObjectId(TUTOR),
    firstName: 'Ana',
    lastName: 'Teacher',
    email: 'ana@example.com',
  });

  liveStreaming = {
    streamProvider: 'youtube',
    provision: jest.fn().mockResolvedValue({
      provider: 'self',
      vimeoEventId: null,
      youtubeBroadcastId: null,
      youtubeStreamId: null,
      rtmpUrl: null,
      streamKey: null,
      embedUrl: 'self',
    }),
    providerOf: jest.fn((live: any) => live?.provider ?? 'vimeo'),
    end: jest.fn().mockResolvedValue(undefined),
    teardown: jest.fn().mockResolvedValue(undefined),
  };
  chatService = {
    createClassConversation: jest
      .fn()
      .mockImplementation(async () => ({ _id: new Types.ObjectId() })),
    addParticipant: jest.fn().mockResolvedValue(undefined),
  };
  chatGateway = { emitToConversation: jest.fn(), emitToUsers: jest.fn() };
  notifications = { create: jest.fn().mockResolvedValue({}) };

  service = new TeacherStreamsService(
    streamModel as any,
    classModel as any,
    liveStreaming,
    chatService,
    chatGateway,
    notifications,
  );
});

async function startLiveStream(): Promise<string> {
  const { streamId } = await service.startOrResume(TUTOR, 'Algebra Q&A');
  await service.goLive(streamId, TUTOR);
  return streamId;
}

describe('starting a stream', () => {
  it('opens an idle stream with a Q&A room and broadcaster details', async () => {
    const info = await service.startOrResume(TUTOR, 'Algebra Q&A');

    expect(info.status).toBe(LiveStatus.IDLE);
    expect(info.provider).toBe('self');
    // Streams use their own provider setting, not the live-class one.
    expect(liveStreaming.provision).toHaveBeenCalledWith('Algebra Q&A', 'youtube');
    expect(info.conversationId).toBeTruthy();
    expect(chatService.createClassConversation).toHaveBeenCalledWith(
      [TUTOR],
      info.streamId,
    );
    // Not live yet: the cards must not light up before video flows.
    expect(await service.listLive()).toEqual([]);
  });

  it('returns the same stream on a second click instead of opening another', async () => {
    const first = await service.startOrResume(TUTOR, 'Algebra Q&A');
    const second = await service.startOrResume(TUTOR, 'Different title');

    expect(second.streamId).toBe(first.streamId);
    expect(liveStreaming.provision).toHaveBeenCalledTimes(1);
    expect(await streamModel.countDocuments({ active: true })).toBe(1);
  });

  it('lets the database refuse a second active stream for one teacher', async () => {
    await service.startOrResume(TUTOR);
    await expect(
      streamModel.create({ tutorId: new Types.ObjectId(TUTOR), active: true }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('allows different teachers to be live at the same time', async () => {
    await service.startOrResume(TUTOR);
    await service.startOrResume(OTHER_TUTOR);
    expect(await streamModel.countDocuments({ active: true })).toBe(2);
  });
});

describe('going live', () => {
  it('shows the teacher as live and alerts their students once', async () => {
    await classModel.create({
      tutorId: new Types.ObjectId(TUTOR),
      title: 'Past class',
      description: 'x',
      startTime: new Date(),
      endTime: new Date(),
      students: [new Types.ObjectId(STUDENT)],
    });

    const streamId = await startLiveStream();

    const live = await service.listLive();
    expect(live).toEqual([
      expect.objectContaining({
        streamId,
        tutorId: TUTOR,
        tutorName: 'Ana Teacher',
        title: 'Algebra Q&A',
      }),
    ]);
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create.mock.calls[0][0]).toMatchObject({
      userId: STUDENT,
      actionPayload: { kind: 'stream_live', joinUrl: `/student/live/${streamId}` },
    });

    // Camera dropped and came back: resuming must not alert again.
    await service.goLive(streamId, TUTOR);
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it("refuses another teacher's attempt to go live on the stream", async () => {
    const { streamId } = await service.startOrResume(TUTOR);
    await expect(service.goLive(streamId, OTHER_TUTOR)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses to go live on an ended stream', async () => {
    const streamId = await startLiveStream();
    await service.end(streamId, tutor);
    await expect(service.goLive(streamId, TUTOR)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('ending a stream', () => {
  it('takes the stream off the live list and frees the teacher to start again', async () => {
    const streamId = await startLiveStream();

    const ended = await service.end(streamId, tutor);

    expect(ended.status).toBe(LiveStatus.ENDED);
    expect(await service.listLive()).toEqual([]);
    expect(liveStreaming.end).toHaveBeenCalledTimes(1);
    const doc = await streamModel.findById(streamId).lean<any>();
    expect(doc.active).toBe(false);
    expect(doc.endedBy).toBe('tutor');

    const next = await service.startOrResume(TUTOR);
    expect(next.streamId).not.toBe(streamId);
  });

  it('lets an admin end any stream', async () => {
    const streamId = await startLiveStream();
    await service.end(streamId, admin);
    const doc = await streamModel.findById(streamId).lean<any>();
    expect(doc.endedBy).toBe('admin');
  });

  it("refuses another teacher ending someone else's stream", async () => {
    const streamId = await startLiveStream();
    await expect(service.end(streamId, otherTutor)).rejects.toThrow(
      ForbiddenException,
    );
    expect(await service.listLive()).toHaveLength(1);
  });

  it('is harmless to end twice', async () => {
    const streamId = await startLiveStream();
    await service.end(streamId, tutor);
    await service.end(streamId, tutor);
    expect(liveStreaming.end).toHaveBeenCalledTimes(1);
  });
});

describe('joining a stream', () => {
  it('lets any student join and seats them in the Q&A room', async () => {
    const streamId = await startLiveStream();

    const info = await service.getWatchInfo(streamId, student);

    expect(info.live.status).toBe(LiveStatus.LIVE);
    expect(info.live.provider).toBe('self');
    expect(info.tutor).toEqual({ _id: TUTOR, name: 'Ana Teacher' });
    expect(chatService.addParticipant).toHaveBeenCalledWith(
      info.live.conversationId,
      STUDENT,
    );
    const doc = await streamModel.findById(streamId).lean<any>();
    expect(doc.viewers.map(String)).toEqual([STUDENT]);
  });

  it.each([
    ['another teacher', otherTutor],
    ['the teacher themself', tutor],
    ['an admin', admin],
  ])('refuses %s with a clear message', async (_label, actor) => {
    const streamId = await startLiveStream();
    await expect(service.getWatchInfo(streamId, actor)).rejects.toThrow(
      STUDENTS_ONLY_MESSAGE,
    );
    expect(chatService.addParticipant).not.toHaveBeenCalled();
  });

  it('tells a student a finished stream has ended without seating them', async () => {
    const streamId = await startLiveStream();
    await service.end(streamId, tutor);

    const info = await service.getWatchInfo(streamId, student);

    expect(info.status).toBe(LiveStatus.ENDED);
    expect(info.live.embedUrl).toBeNull();
    expect(chatService.addParticipant).not.toHaveBeenCalled();
  });
});

describe('HLS playback for streams', () => {
  function makeHls() {
    const jwtService: any = {
      signAsync: jest.fn().mockResolvedValue('signed'),
      verify: jest.fn(),
    };
    const config = { get: () => '/data/live-hls' } as unknown as ConfigService;
    // The class lookup must never be reached for a stream id.
    const classesService: any = {
      findOne: jest.fn().mockRejectedValue(new Error('not a class')),
    };
    const hls = new LiveHlsService(classesService, jwtService, config, service);
    return { hls, jwtService };
  }

  it('mints a playback token for a student', async () => {
    const streamId = await startLiveStream();
    const { hls } = makeHls();
    await expect(
      hls.mintPlaybackToken(streamId, STUDENT, 'student'),
    ).resolves.toBe('signed');
  });

  it.each([
    ['another teacher', OTHER_TUTOR, 'tutor'],
    ['an admin', ADMIN, 'admin'],
  ])('refuses %s a playback token', async (_label, userId, role) => {
    const streamId = await startLiveStream();
    const { hls } = makeHls();
    await expect(hls.mintPlaybackToken(streamId, userId, role)).rejects.toThrow(
      STUDENTS_ONLY_MESSAGE,
    );
  });

  it('cuts a student off once the stream has ended', async () => {
    const streamId = await startLiveStream();
    const { hls, jwtService } = makeHls();
    jwtService.verify.mockReturnValue({
      purpose: 'hls',
      classId: streamId,
      sub: STUDENT,
      role: 'student',
    });
    await service.end(streamId, tutor);
    await expect(hls.assertPlayable('t', streamId)).rejects.toThrow();
  });
});

describe('stale-stream sweep', () => {
  it('ends a self-hosted stream whose camera stopped feeding', async () => {
    const streamId = await startLiveStream();
    const later = new Date(Date.now() + STALE_BROADCAST_MS + 1000);

    expect(await service.sweepStaleStreams(later)).toBe(1);

    const doc = await streamModel.findById(streamId).lean<any>();
    expect(doc.active).toBe(false);
    expect(doc.endedBy).toBe('system');
  });

  const YOUTUBE_EVENT = {
    provider: 'youtube',
    vimeoEventId: null,
    youtubeBroadcastId: 'b-1',
    youtubeStreamId: 's-1',
    rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'key-1',
    embedUrl: 'https://www.youtube.com/embed/b-1',
  };

  it('ends a YouTube stream fed by the browser relay once its camera stops', async () => {
    liveStreaming.provision.mockResolvedValue(YOUTUBE_EVENT);
    const streamId = await startLiveStream();
    await service.heartbeat(streamId); // the relay carried video
    const later = new Date(Date.now() + STALE_BROADCAST_MS + 1000);

    expect(await service.sweepStaleStreams(later)).toBe(1);
    expect(liveStreaming.end).toHaveBeenCalledTimes(1);
  });

  it('leaves an OBS stream straight to YouTube to its teacher', async () => {
    liveStreaming.provision.mockResolvedValue(YOUTUBE_EVENT);
    await startLiveStream(); // no relay heartbeat: OBS pushes to YouTube itself
    const later = new Date(Date.now() + STALE_BROADCAST_MS + 1000);

    expect(await service.sweepStaleStreams(later)).toBe(0);
    expect(await service.listLive()).toHaveLength(1);
  });

  it('deletes the unused event of a setup that never went live', async () => {
    liveStreaming.provision.mockResolvedValue(YOUTUBE_EVENT);
    await service.startOrResume(TUTOR);
    const later = new Date(Date.now() + 3 * 60 * 60 * 1000);

    expect(await service.sweepStaleStreams(later)).toBe(1);
    expect(liveStreaming.teardown).toHaveBeenCalledTimes(1);
    expect(liveStreaming.end).not.toHaveBeenCalled();
  });

  it('leaves a stream alone while the relay keeps reporting video', async () => {
    const streamId = await startLiveStream();
    await service.heartbeat(streamId);
    expect(await service.sweepStaleStreams(new Date())).toBe(0);
    expect(await service.listLive()).toHaveLength(1);
  });
});
