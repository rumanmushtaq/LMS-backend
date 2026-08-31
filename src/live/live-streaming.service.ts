import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VimeoService } from '../vimeo/vimeo.service';
import { YouTubeService } from '../youtube/youtube.service';

export type LiveProvider = 'vimeo' | 'youtube';

export interface LiveCredentials {
  rtmpUrl: string | null;
  streamKey: string | null;
  embedUrl: string | null;
}

/** What a freshly provisioned broadcast stores on the class's liveSession. */
export interface ProvisionedLive extends LiveCredentials {
  provider: LiveProvider;
  vimeoEventId: string | null;
  youtubeBroadcastId: string | null;
  youtubeStreamId: string | null;
}

/**
 * Facade over the broadcast providers so ClassesService never branches on
 * Vimeo vs YouTube.
 *
 * Two rules:
 * - NEW sessions go to the globally configured provider (`LIVE_PROVIDER`).
 * - EXISTING sessions are always routed to the provider they were created
 *   on, so flipping the env never strands an in-flight class.
 * - `end`/`teardown` never throw: a provider hiccup must not block ending
 *   or cancelling a class.
 */
@Injectable()
export class LiveStreamingService {
  private readonly logger = new Logger('LiveStreamingService');

  constructor(
    private readonly config: ConfigService,
    private readonly vimeo: VimeoService,
    private readonly youtube: YouTubeService,
  ) {}

  /** Provider new live sessions are provisioned on. */
  get provider(): LiveProvider {
    return this.config.get<string>('live.provider') === 'youtube'
      ? 'youtube'
      : 'vimeo';
  }

  /** Provider that owns an existing session. Legacy documents (no `provider`
   *  field) predate YouTube support and were all Vimeo. */
  providerOf(live: any): LiveProvider {
    if (live?.provider === 'youtube') return 'youtube';
    if (live?.provider === 'vimeo') return 'vimeo';
    return live?.youtubeBroadcastId ? 'youtube' : 'vimeo';
  }

  hasEvent(live: any): boolean {
    return !!(live?.vimeoEventId || live?.youtubeBroadcastId);
  }

  async provision(title: string): Promise<ProvisionedLive> {
    if (this.provider === 'youtube') {
      const event = await this.youtube.createLiveEvent(title);
      return {
        provider: 'youtube',
        vimeoEventId: null,
        youtubeBroadcastId: event.broadcastId,
        youtubeStreamId: event.streamId,
        rtmpUrl: event.rtmpUrl,
        streamKey: event.streamKey,
        embedUrl: event.embedUrl,
      };
    }

    const event = await this.vimeo.createLiveEvent(title);
    return {
      provider: 'vimeo',
      vimeoEventId: event.eventId,
      youtubeBroadcastId: null,
      youtubeStreamId: null,
      rtmpUrl: event.rtmpUrl,
      streamKey: event.streamKey,
      embedUrl: event.embedUrl,
    };
  }

  /** Re-read ingest credentials from the provider that owns the session. */
  async refresh(live: any): Promise<LiveCredentials> {
    if (this.providerOf(live) === 'youtube') {
      const event = await this.youtube.getLiveEvent(
        live.youtubeBroadcastId,
        live.youtubeStreamId,
      );
      return {
        rtmpUrl: event.rtmpUrl,
        streamKey: event.streamKey,
        embedUrl: event.embedUrl,
      };
    }

    const event = await this.vimeo.getLiveEvent(live.vimeoEventId);
    return {
      rtmpUrl: event.rtmpUrl,
      streamKey: event.streamKey,
      embedUrl: event.embedUrl,
    };
  }

  /**
   * The tutor ended the class: stop the broadcast on its provider. Vimeo
   * needs nothing (the tutor stops OBS); YouTube gets a complete-transition
   * and, in live-only mode, the archived video removed.
   */
  async end(live: any): Promise<void> {
    if (this.providerOf(live) !== 'youtube' || !live?.youtubeBroadcastId) {
      return;
    }
    try {
      await this.youtube.endLiveEvent(live.youtubeBroadcastId);
    } catch (err: any) {
      this.logger.warn(`Ending YouTube broadcast failed: ${err?.message}`);
    }
  }

  /** Class cancelled/removed: delete whatever event was provisioned. */
  async teardown(live: any): Promise<void> {
    if (!this.hasEvent(live)) return;
    try {
      if (this.providerOf(live) === 'youtube') {
        await this.youtube.deleteLiveEvent(
          live.youtubeBroadcastId,
          live.youtubeStreamId,
        );
      } else {
        await this.vimeo.deleteLiveEvent(live.vimeoEventId);
      }
    } catch (err: any) {
      this.logger.warn(`Live event teardown failed: ${err?.message}`);
    }
  }
}
