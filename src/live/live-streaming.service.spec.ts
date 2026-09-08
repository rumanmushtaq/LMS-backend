import { ConfigService } from '@nestjs/config';
import { LiveStreamingService } from './live-streaming.service';

/**
 * The facade's one job: route each live session to the provider that owns it,
 * and never let a provider error block ending or cancelling a class.
 */

function makeService(provider: string | undefined = undefined) {
  const vimeo: any = {
    createLiveEvent: jest.fn().mockResolvedValue({
      eventId: 'v1',
      rtmpUrl: 'rtmp://vimeo',
      streamKey: 'vk',
      embedUrl: 'https://vimeo.com/event/v1/embed',
    }),
    getLiveEvent: jest.fn().mockResolvedValue({
      eventId: 'v1',
      rtmpUrl: 'rtmp://vimeo',
      streamKey: 'vk',
      embedUrl: 'https://vimeo.com/event/v1/embed',
    }),
    deleteLiveEvent: jest.fn().mockResolvedValue(undefined),
  };
  const youtube: any = {
    createLiveEvent: jest.fn().mockResolvedValue({
      broadcastId: 'b1',
      streamId: 's1',
      rtmpUrl: 'rtmp://youtube',
      streamKey: 'yk',
      embedUrl: 'https://www.youtube.com/embed/b1',
    }),
    getLiveEvent: jest.fn().mockResolvedValue({
      broadcastId: 'b1',
      streamId: 's1',
      rtmpUrl: 'rtmp://youtube',
      streamKey: 'yk',
      embedUrl: 'https://www.youtube.com/embed/b1',
    }),
    endLiveEvent: jest.fn().mockResolvedValue(undefined),
    deleteLiveEvent: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: (key: string) => (key === 'live.provider' ? provider : undefined),
  } as ConfigService;
  const service = new LiveStreamingService(config, vimeo, youtube);
  return { service, vimeo, youtube };
}

const vimeoSession = { provider: 'vimeo', vimeoEventId: 'v1' };
const youtubeSession = {
  provider: 'youtube',
  youtubeBroadcastId: 'b1',
  youtubeStreamId: 's1',
};

describe('provision', () => {
  it('uses Vimeo when no provider is configured (non-breaking default)', async () => {
    const { service, vimeo, youtube } = makeService(undefined);
    const event = await service.provision('Algebra');
    expect(vimeo.createLiveEvent).toHaveBeenCalledWith('Algebra');
    expect(youtube.createLiveEvent).not.toHaveBeenCalled();
    expect(event).toMatchObject({
      provider: 'vimeo',
      vimeoEventId: 'v1',
      youtubeBroadcastId: null,
      rtmpUrl: 'rtmp://vimeo',
    });
  });

  it('uses YouTube when configured', async () => {
    const { service, youtube } = makeService('youtube');
    const event = await service.provision('Algebra');
    expect(youtube.createLiveEvent).toHaveBeenCalledWith('Algebra');
    expect(event).toMatchObject({
      provider: 'youtube',
      youtubeBroadcastId: 'b1',
      youtubeStreamId: 's1',
      vimeoEventId: null,
      streamKey: 'yk',
    });
  });
});

describe('refresh', () => {
  it("routes by the session's own provider, not the global config", async () => {
    // Config says youtube, but this class was provisioned on Vimeo — flipping
    // the env must not strand an in-flight class.
    const { service, vimeo, youtube } = makeService('youtube');
    const creds = await service.refresh(vimeoSession);
    expect(vimeo.getLiveEvent).toHaveBeenCalledWith('v1');
    expect(youtube.getLiveEvent).not.toHaveBeenCalled();
    expect(creds.rtmpUrl).toBe('rtmp://vimeo');
  });

  it('treats a legacy session without a provider as Vimeo', async () => {
    const { service, vimeo } = makeService('youtube');
    await service.refresh({ vimeoEventId: 'v1' });
    expect(vimeo.getLiveEvent).toHaveBeenCalledWith('v1');
  });

  it('refreshes YouTube credentials from the stored ids', async () => {
    const { service, youtube } = makeService('vimeo');
    const creds = await service.refresh(youtubeSession);
    expect(youtube.getLiveEvent).toHaveBeenCalledWith('b1', 's1');
    expect(creds.streamKey).toBe('yk');
  });
});

describe('end', () => {
  it('completes the YouTube broadcast', async () => {
    const { service, youtube } = makeService('youtube');
    await service.end(youtubeSession);
    expect(youtube.endLiveEvent).toHaveBeenCalledWith('b1');
  });

  it('is a no-op for Vimeo sessions', async () => {
    const { service, vimeo, youtube } = makeService('vimeo');
    await service.end(vimeoSession);
    expect(vimeo.deleteLiveEvent).not.toHaveBeenCalled();
    expect(youtube.endLiveEvent).not.toHaveBeenCalled();
  });

  it('never throws — a provider hiccup must not block ending a class', async () => {
    const { service, youtube } = makeService('youtube');
    youtube.endLiveEvent.mockRejectedValue(new Error('boom'));
    await expect(service.end(youtubeSession)).resolves.toBeUndefined();
  });
});

describe('teardown', () => {
  it('deletes the event on the owning provider', async () => {
    const { service, vimeo, youtube } = makeService('vimeo');
    await service.teardown(youtubeSession);
    expect(youtube.deleteLiveEvent).toHaveBeenCalledWith('b1', 's1');
    expect(vimeo.deleteLiveEvent).not.toHaveBeenCalled();
  });

  it('does nothing when the session never had an event', async () => {
    const { service, vimeo, youtube } = makeService('vimeo');
    await service.teardown({});
    await service.teardown(null);
    expect(vimeo.deleteLiveEvent).not.toHaveBeenCalled();
    expect(youtube.deleteLiveEvent).not.toHaveBeenCalled();
  });

  it('never throws when the provider rejects', async () => {
    const { service, vimeo } = makeService('vimeo');
    vimeo.deleteLiveEvent.mockRejectedValue(new Error('gone'));
    await expect(service.teardown(vimeoSession)).resolves.toBeUndefined();
  });
});

describe('hasEvent', () => {
  it('recognises an event from either provider', () => {
    const { service } = makeService('vimeo');
    expect(service.hasEvent(vimeoSession)).toBe(true);
    expect(service.hasEvent(youtubeSession)).toBe(true);
    expect(service.hasEvent({})).toBe(false);
    expect(service.hasEvent(undefined)).toBe(false);
  });
});

describe("provider 'self' (our own HLS delivery)", () => {
  const selfSession = { provider: 'self', embedUrl: 'self' };

  it('provisions without touching any external provider', async () => {
    const { service, vimeo, youtube } = makeService('self');
    const event = await service.provision('Algebra');
    expect(vimeo.createLiveEvent).not.toHaveBeenCalled();
    expect(youtube.createLiveEvent).not.toHaveBeenCalled();
    expect(event).toMatchObject({
      provider: 'self',
      vimeoEventId: null,
      youtubeBroadcastId: null,
      rtmpUrl: null,
      streamKey: null,
    });
    expect(event.embedUrl).toBeTruthy();
  });

  it('counts a self session as a provisioned event', () => {
    const { service } = makeService('self');
    expect(service.hasEvent(selfSession)).toBe(true);
  });

  it('refresh, end and teardown are external no-ops for self sessions', async () => {
    const { service, vimeo, youtube } = makeService('self');
    await service.refresh(selfSession);
    await service.end(selfSession);
    await service.teardown(selfSession);
    expect(vimeo.getLiveEvent).not.toHaveBeenCalled();
    expect(youtube.getLiveEvent).not.toHaveBeenCalled();
    expect(vimeo.deleteLiveEvent).not.toHaveBeenCalled();
    expect(youtube.deleteLiveEvent).not.toHaveBeenCalled();
  });
});
