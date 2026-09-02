import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { YouTubeService } from './youtube.service';

/**
 * The service talks to Google over plain fetch; these specs replace fetch and
 * assert on what would go over the wire — payload shapes, auth reuse, and the
 * tolerance rules for ending/cleaning up broadcasts.
 */

type FetchCall = { url: string; init: RequestInit };

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});

function installFetch(handler: (url: string, init: RequestInit) => any): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  return { calls };
}

const TOKEN_RESPONSE = { access_token: 'at-1', expires_in: 3600 };
const BROADCAST_RESPONSE = { id: 'b1' };
const STREAM_RESPONSE = {
  id: 's1',
  cdn: {
    ingestionInfo: {
      ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2',
      streamName: 'key-123',
    },
  },
};

/** Routes the happy-path Google endpoints; tests override per-case. */
const happyHandler = (url: string) => {
  if (url.includes('oauth2.googleapis.com/token'))
    return jsonResponse(TOKEN_RESPONSE);
  if (url.includes('/liveBroadcasts/bind')) return jsonResponse({ id: 'b1' });
  if (url.includes('/liveBroadcasts')) return jsonResponse(BROADCAST_RESPONSE);
  if (url.includes('/liveStreams')) return jsonResponse(STREAM_RESPONSE);
  if (url.includes('/videos')) return jsonResponse(undefined, 204);
  throw new Error(`unexpected url ${url}`);
};

function makeService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    'youtube.clientId': 'cid',
    'youtube.clientSecret': 'secret',
    'youtube.refreshToken': 'refresh',
    'youtube.deleteAfterEnd': true,
    ...overrides,
  };
  const config = { get: (key: string) => values[key] } as ConfigService;
  return new YouTubeService(config);
}

const bodyOf = (call: FetchCall): any => JSON.parse(String(call.init.body));

afterEach(() => {
  delete (global as any).fetch;
  jest.restoreAllMocks();
});

describe('configuration guard', () => {
  it('rejects with a clear setup message when credentials are missing', async () => {
    const service = makeService({ 'youtube.clientId': undefined });
    await expect(service.createLiveEvent('Algebra')).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(service.createLiveEvent('Algebra')).rejects.toThrow(
      /YOUTUBE_CLIENT_ID/,
    );
  });
});

describe('createLiveEvent', () => {
  it('creates an unlisted auto-start broadcast and returns RTMP credentials', async () => {
    const { calls } = installFetch(happyHandler);
    const service = makeService();

    const event = await service.createLiveEvent('Algebra 101');

    expect(event).toEqual({
      broadcastId: 'b1',
      streamId: 's1',
      rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'key-123',
      embedUrl: expect.stringContaining('/embed/b1'),
    });

    const broadcastCall = calls.find(
      (c) => c.url.includes('/liveBroadcasts') && !c.url.includes('/bind'),
    )!;
    const broadcastBody = bodyOf(broadcastCall);
    expect(broadcastBody.status.privacyStatus).toBe('unlisted');
    expect(broadcastBody.status.selfDeclaredMadeForKids).toBe(false);
    expect(broadcastBody.contentDetails.enableAutoStart).toBe(true);
    expect(broadcastBody.contentDetails.enableAutoStop).toBe(true);
    // Without this, players outside youtube.com get "Playback on other
    // websites has been disabled" — the whole product is an embedded player.
    expect(broadcastBody.contentDetails.enableEmbed).toBe(true);
    expect(broadcastBody.snippet.title).toBe('Algebra 101');

    const bind = calls.find((c) => c.url.includes('/liveBroadcasts/bind'))!;
    expect(bind.url).toContain('id=b1');
    expect(bind.url).toContain('streamId=s1');
  });

  it('fetches the OAuth access token once and reuses it across calls', async () => {
    const { calls } = installFetch(happyHandler);
    const service = makeService();

    await service.createLiveEvent('One');
    await service.getLiveEvent('b1', 's1');

    const tokenCalls = calls.filter((c) =>
      c.url.includes('oauth2.googleapis.com/token'),
    );
    expect(tokenCalls).toHaveLength(1);
    const apiCall = calls.find((c) =>
      c.url.includes('googleapis.com/youtube'),
    )!;
    expect((apiCall.init.headers as any).Authorization).toBe('Bearer at-1');
  });
});

describe('createLiveEvent on channels that cannot embed', () => {
  it('retries without enableEmbed when YouTube rejects the embed setting', async () => {
    // Live-stream embedding is gated on channel eligibility (monetization);
    // ineligible channels must still be able to hold classes — the player
    // falls back, but the broadcast must exist.
    let broadcastAttempts = 0;
    const { calls } = installFetch((url, init) => {
      if (url.includes('oauth2.googleapis.com/token'))
        return jsonResponse(TOKEN_RESPONSE);
      if (url.includes('/liveBroadcasts/bind')) return jsonResponse({ id: 'b1' });
      if (url.includes('/liveBroadcasts')) {
        broadcastAttempts += 1;
        const body = JSON.parse(String(init.body));
        if (body.contentDetails.enableEmbed) {
          return jsonResponse(
            {
              error: {
                message: 'Embed setting was invalid',
                errors: [{ reason: 'invalidEmbedSetting' }],
              },
            },
            400,
          );
        }
        return jsonResponse(BROADCAST_RESPONSE);
      }
      if (url.includes('/liveStreams')) return jsonResponse(STREAM_RESPONSE);
      throw new Error(`unexpected url ${url}`);
    });
    const service = makeService();

    const event = await service.createLiveEvent('Algebra');

    expect(broadcastAttempts).toBe(2);
    expect(event.broadcastId).toBe('b1');
    expect(event.streamKey).toBe('key-123');
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('getLiveEvent', () => {
  it('re-reads ingest credentials for an existing stream', async () => {
    installFetch((url) => {
      if (url.includes('oauth2')) return jsonResponse(TOKEN_RESPONSE);
      if (url.includes('/liveStreams'))
        return jsonResponse({ items: [STREAM_RESPONSE] });
      throw new Error(`unexpected url ${url}`);
    });
    const service = makeService();

    const event = await service.getLiveEvent('b1', 's1');
    expect(event.rtmpUrl).toBe('rtmp://a.rtmp.youtube.com/live2');
    expect(event.streamKey).toBe('key-123');
    expect(event.embedUrl).toContain('/embed/b1');
  });
});

describe('endLiveEvent', () => {
  it('tolerates a broadcast that already ended and still deletes the video', async () => {
    const { calls } = installFetch((url) => {
      if (url.includes('oauth2')) return jsonResponse(TOKEN_RESPONSE);
      if (url.includes('/liveBroadcasts/transition'))
        return jsonResponse(
          { error: { errors: [{ reason: 'redundantTransition' }] } },
          403,
        );
      if (url.includes('/videos')) return jsonResponse(undefined, 204);
      throw new Error(`unexpected url ${url}`);
    });
    const service = makeService();

    await expect(service.endLiveEvent('b1')).resolves.toBeUndefined();
    expect(
      calls.some(
        (c) => c.url.includes('/videos') && c.init.method === 'DELETE',
      ),
    ).toBe(true);
  });

  it('keeps the recording when delete-after-end is off', async () => {
    const { calls } = installFetch((url) => {
      if (url.includes('oauth2')) return jsonResponse(TOKEN_RESPONSE);
      if (url.includes('/liveBroadcasts/transition'))
        return jsonResponse({ id: 'b1' });
      throw new Error(`unexpected url ${url}`);
    });
    const service = makeService({ 'youtube.deleteAfterEnd': false });

    await service.endLiveEvent('b1');
    expect(calls.some((c) => c.url.includes('/videos'))).toBe(false);
  });
});

describe('deleteLiveEvent', () => {
  it('cleans up broadcast and stream, swallowing provider errors', async () => {
    const { calls } = installFetch((url) => {
      if (url.includes('oauth2')) return jsonResponse(TOKEN_RESPONSE);
      if (url.includes('/liveBroadcasts'))
        return jsonResponse({ error: 'nope' }, 404);
      if (url.includes('/liveStreams')) return jsonResponse(undefined, 204);
      throw new Error(`unexpected url ${url}`);
    });
    const service = makeService();

    await expect(service.deleteLiveEvent('b1', 's1')).resolves.toBeUndefined();
    expect(
      calls.some(
        (c) => c.url.includes('/liveStreams') && c.init.method === 'DELETE',
      ),
    ).toBe(true);
  });
});
