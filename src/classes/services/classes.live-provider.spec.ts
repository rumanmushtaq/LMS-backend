import { BadRequestException } from '@nestjs/common';
import { ClassesService } from './classes.service';
import { ClassStatus, LiveStatus } from '../schemas/class.schema';

/**
 * Provider-agnostic live sessions: ClassesService must go through the
 * LiveStreamingService facade — provisioning stores whichever provider the
 * platform is configured for, and ending a class ends the broadcast too.
 */

const TUTOR = 'tutor-1';

function makeService() {
  const classSessionModel: any = {};
  const liveStreaming: any = {
    hasEvent: jest.fn(
      (live: any) => !!(live?.vimeoEventId || live?.youtubeBroadcastId),
    ),
    provision: jest.fn().mockResolvedValue({
      provider: 'youtube',
      vimeoEventId: null,
      youtubeBroadcastId: 'b1',
      youtubeStreamId: 's1',
      rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'key-123',
      embedUrl: 'https://www.youtube.com/embed/b1',
    }),
    refresh: jest.fn().mockResolvedValue({
      rtmpUrl: 'rtmp://refreshed',
      streamKey: 'refreshed-key',
      embedUrl: 'https://www.youtube.com/embed/b1',
    }),
    end: jest.fn().mockResolvedValue(undefined),
    teardown: jest.fn().mockResolvedValue(undefined),
  };
  const chatService: any = {
    createConversation: jest.fn().mockResolvedValue({ _id: 'conv-1' }),
    addParticipant: jest.fn().mockResolvedValue({}),
  };
  const chatGateway: any = {
    emitToConversation: jest.fn(),
    emitToUsers: jest.fn(),
  };
  const notificationsService: any = { create: jest.fn().mockResolvedValue({}) };

  const service = new ClassesService(
    classSessionModel,
    {} as any,
    liveStreaming,
    chatService,
    chatGateway,
    notificationsService,
  );
  return { service, liveStreaming, chatService };
}

const fakeClass = (liveSession: any = {}) => ({
  _id: 'class-1',
  tutorId: { _id: TUTOR, toString: () => TUTOR },
  students: ['student-1'],
  title: 'Algebra',
  status: ClassStatus.SCHEDULED,
  startTime: new Date(),
  endTime: new Date(),
  liveSession: {
    provider: 'vimeo',
    vimeoEventId: null,
    youtubeBroadcastId: null,
    youtubeStreamId: null,
    rtmpUrl: null,
    streamKey: null,
    embedUrl: null,
    conversationId: null,
    status: LiveStatus.IDLE,
    startedAt: null,
    endedAt: null,
    ...liveSession,
  },
  save: jest.fn().mockResolvedValue(true),
});

describe('setupLive with the provider facade', () => {
  it('provisions once and stores the returned provider ids on the session', async () => {
    const { service, liveStreaming } = makeService();
    const cls = fakeClass();
    jest.spyOn(service, 'findOne').mockResolvedValue(cls as any);

    const payload = await service.setupLive('class-1', TUTOR);

    expect(liveStreaming.provision).toHaveBeenCalledWith('Algebra');
    // The tutor page needs the schedule to show a countdown before start.
    expect(payload.startTime).toBeInstanceOf(Date);
    expect(payload.endTime).toBeInstanceOf(Date);
    expect(cls.liveSession.provider).toBe('youtube');
    expect(cls.liveSession.youtubeBroadcastId).toBe('b1');
    expect(cls.liveSession.youtubeStreamId).toBe('s1');
    expect(cls.liveSession.rtmpUrl).toBe('rtmp://a.rtmp.youtube.com/live2');
    expect(cls.liveSession.streamKey).toBe('key-123');
    expect(cls.liveSession.embedUrl).toContain('/embed/b1');
    expect(cls.save).toHaveBeenCalled();
  });

  it('re-fetches missing credentials through the facade instead of re-provisioning', async () => {
    const { service, liveStreaming } = makeService();
    const cls = fakeClass({
      provider: 'youtube',
      youtubeBroadcastId: 'b1',
      youtubeStreamId: 's1',
      rtmpUrl: null,
      streamKey: null,
    });
    jest.spyOn(service, 'findOne').mockResolvedValue(cls as any);

    await service.setupLive('class-1', TUTOR);

    expect(liveStreaming.provision).not.toHaveBeenCalled();
    expect(liveStreaming.refresh).toHaveBeenCalledWith(cls.liveSession);
    expect(cls.liveSession.rtmpUrl).toBe('rtmp://refreshed');
    expect(cls.liveSession.streamKey).toBe('refreshed-key');
  });
});

describe('startLive guard', () => {
  it('refuses to go live before an event exists on any provider', async () => {
    const { service } = makeService();
    const cls = fakeClass();
    jest.spyOn(service, 'findOne').mockResolvedValue(cls as any);

    await expect(service.startLive('class-1', TUTOR)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts a session provisioned on YouTube', async () => {
    const { service } = makeService();
    const cls = fakeClass({
      provider: 'youtube',
      youtubeBroadcastId: 'b1',
      youtubeStreamId: 's1',
      embedUrl: 'https://www.youtube.com/embed/b1',
    });
    jest.spyOn(service, 'findOne').mockResolvedValue(cls as any);

    await service.startLive('class-1', TUTOR);
    expect(cls.liveSession.status).toBe(LiveStatus.LIVE);
  });
});

describe('endLive', () => {
  it('ends the broadcast on the owning provider and completes the class', async () => {
    const { service, liveStreaming } = makeService();
    const cls = fakeClass({
      provider: 'youtube',
      youtubeBroadcastId: 'b1',
      youtubeStreamId: 's1',
      status: LiveStatus.LIVE,
    });
    jest.spyOn(service, 'findOne').mockResolvedValue(cls as any);

    await service.endLive('class-1', TUTOR);

    expect(liveStreaming.end).toHaveBeenCalledWith(cls.liveSession);
    expect(cls.liveSession.status).toBe(LiveStatus.ENDED);
    expect(cls.status).toBe(ClassStatus.COMPLETED);
  });
});
