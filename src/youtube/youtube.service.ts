import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Normalized result of creating (or re-reading) a YouTube live broadcast.
 * `rtmpUrl` + `streamKey` are the broadcaster ingest credentials the tutor
 * plugs into OBS (or the browser encoder). `embedUrl` is the iframe URL
 * enrolled students watch — the broadcast id doubles as the video id.
 */
export interface YouTubeLiveEvent {
  broadcastId: string;
  streamId: string;
  rtmpUrl: string | null;
  streamKey: string | null;
  embedUrl: string;
}

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const embedUrlFor = (broadcastId: string): string =>
  `https://www.youtube.com/embed/${broadcastId}?autoplay=1&rel=0`;

const safeJson = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * YouTube Live via the Data API v3, mirroring VimeoService's shape: plain
 * fetch, Nest exceptions, no SDK dependency.
 *
 * Auth is a single platform channel's OAuth refresh token (the channel must
 * have live streaming enabled). Broadcasts are created `unlisted` with
 * `enableAutoStart`/`enableAutoStop`, so YouTube flips the broadcast live
 * when RTMP data arrives and completes it when it stops — no transition
 * polling from our side.
 *
 * Docs: https://developers.google.com/youtube/v3/live/docs
 */
@Injectable()
export class YouTubeService {
  private readonly logger = new Logger('YouTubeService');

  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  private credentials() {
    const clientId = this.config.get<string>('youtube.clientId');
    const clientSecret = this.config.get<string>('youtube.clientSecret');
    const refreshToken = this.config.get<string>('youtube.refreshToken');
    if (!clientId || !clientSecret || !refreshToken) {
      throw new ServiceUnavailableException(
        'YouTube Live is not configured. Set YOUTUBE_CLIENT_ID, ' +
          'YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN in the backend ' +
          '.env to enable live classes (see scripts/get-youtube-refresh-token.mjs).',
      );
    }
    return { clientId, clientSecret, refreshToken };
  }

  /**
   * Live-only mode: when on (the default), ending a broadcast also deletes
   * the video YouTube auto-archives, so no replay outlives the class.
   */
  private get deleteAfterEnd(): boolean {
    return this.config.get<boolean>('youtube.deleteAfterEnd') !== false;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    const { clientId, clientSecret, refreshToken } = this.credentials();

    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });
    } catch (err: any) {
      this.logger.error(`YouTube token request failed: ${err?.message}`);
      throw new BadGatewayException('Could not reach Google OAuth.');
    }

    const data = safeJson(await res.text());
    if (!res.ok || !data?.access_token) {
      const detail = data?.error_description || data?.error || res.statusText;
      this.logger.error(`YouTube token refresh -> ${res.status}: ${detail}`);
      throw new BadGatewayException(`YouTube auth error: ${detail}`);
    }

    this.accessToken = data.access_token as string;
    // Refresh a minute early so a token never expires mid-request.
    this.accessTokenExpiresAt =
      Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000;
    return this.accessToken;
  }

  private async request(
    method: string,
    pathWithQuery: string,
    body?: Record<string, unknown>,
  ): Promise<any> {
    const token = await this.getAccessToken();

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${pathWithQuery}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err: any) {
      this.logger.error(`YouTube request failed: ${err?.message}`);
      throw new BadGatewayException('Could not reach YouTube.');
    }

    const text = await res.text();
    const data = text ? safeJson(text) : null;

    if (!res.ok) {
      const detail =
        data?.error?.message ||
        data?.error?.errors?.[0]?.reason ||
        res.statusText ||
        'Unknown error';
      this.logger.error(
        `YouTube ${method} ${pathWithQuery} -> ${res.status}: ${detail}`,
      );
      throw new BadGatewayException(`YouTube error (${res.status}): ${detail}`);
    }

    return data;
  }

  /** Like request(), but failures are logged and swallowed — for cleanup paths. */
  private async tryRequest(
    method: string,
    pathWithQuery: string,
  ): Promise<void> {
    try {
      await this.request(method, pathWithQuery);
    } catch (err: any) {
      this.logger.warn(
        `YouTube ${method} ${pathWithQuery} ignored failure: ${err?.message}`,
      );
    }
  }

  /** Create an unlisted, auto-start broadcast + RTMP stream and bind them. */
  async createLiveEvent(title: string): Promise<YouTubeLiveEvent> {
    const broadcast = await this.request(
      'POST',
      '/liveBroadcasts?part=snippet,status,contentDetails',
      {
        snippet: {
          title,
          // AutoStart still requires a nominal scheduled time.
          scheduledStartTime: new Date().toISOString(),
        },
        status: {
          privacyStatus: 'unlisted',
          selfDeclaredMadeForKids: false,
        },
        contentDetails: {
          enableAutoStart: true,
          enableAutoStop: true,
          // Live-only product: no DVR scrubbing, lowest available latency.
          enableDvr: false,
          latencyPreference: 'ultraLow',
        },
      },
    );

    const broadcastId: string | undefined = broadcast?.id;
    if (!broadcastId) {
      throw new BadGatewayException('YouTube did not return a broadcast id.');
    }

    const stream = await this.request('POST', '/liveStreams?part=snippet,cdn', {
      snippet: { title },
      cdn: {
        ingestionType: 'rtmp',
        resolution: 'variable',
        frameRate: 'variable',
      },
    });

    const streamId: string | undefined = stream?.id;
    if (!streamId) {
      throw new BadGatewayException('YouTube did not return a stream id.');
    }

    await this.request(
      'POST',
      `/liveBroadcasts/bind?part=id&id=${broadcastId}&streamId=${streamId}`,
    );

    const ingest = stream?.cdn?.ingestionInfo;
    return {
      broadcastId,
      streamId,
      rtmpUrl: ingest?.ingestionAddress ?? null,
      streamKey: ingest?.streamName ?? null,
      embedUrl: embedUrlFor(broadcastId),
    };
  }

  /** Re-read ingest credentials for an already-provisioned broadcast. */
  async getLiveEvent(
    broadcastId: string,
    streamId: string,
  ): Promise<YouTubeLiveEvent> {
    const data = await this.request(
      'GET',
      `/liveStreams?part=cdn&id=${streamId}`,
    );
    const item = data?.items?.[0] ?? data;
    const ingest = item?.cdn?.ingestionInfo;
    return {
      broadcastId,
      streamId,
      rtmpUrl: ingest?.ingestionAddress ?? null,
      streamKey: ingest?.streamName ?? null,
      embedUrl: embedUrlFor(broadcastId),
    };
  }

  /**
   * End the broadcast. The transition is tolerant — with autoStop the
   * broadcast may already be complete, and a `redundantTransition` from
   * YouTube must not fail the tutor's "End class" click. In live-only mode
   * the auto-archived video (same id as the broadcast) is then deleted.
   */
  async endLiveEvent(broadcastId: string): Promise<void> {
    await this.tryRequest(
      'POST',
      `/liveBroadcasts/transition?part=status&broadcastStatus=complete&id=${broadcastId}`,
    );
    if (this.deleteAfterEnd) {
      await this.tryRequest('DELETE', `/videos?id=${broadcastId}`);
    }
  }

  /** Delete a broadcast + stream (called when a class is cancelled/removed). */
  async deleteLiveEvent(
    broadcastId: string,
    streamId?: string | null,
  ): Promise<void> {
    await this.tryRequest('DELETE', `/liveBroadcasts?id=${broadcastId}`);
    if (streamId) {
      await this.tryRequest('DELETE', `/liveStreams?id=${streamId}`);
    }
  }
}
