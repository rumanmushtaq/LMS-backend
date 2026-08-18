import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  BadGatewayException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Normalized result of creating (or fetching) a Vimeo live event.
 * `rtmpUrl` + `streamKey` are the broadcaster ingest credentials the tutor
 * plugs into OBS. `embedUrl` is the iframe URL enrolled students watch.
 */
export interface VimeoLiveEvent {
  eventId: string;
  rtmpUrl: string | null;
  streamKey: string | null;
  embedUrl: string;
}

/**
 * Thin wrapper around the Vimeo Live Events API.
 *
 * NOTE ON FIELD NAMES: Vimeo returns RTMP ingest data on the live-event
 * resource, but the exact field path has varied across API versions and plan
 * tiers (`rtmp_link`, `rtmps_link`, `stream_key`, `key`, nested under
 * `embed`/`streamable`...). We extract defensively across the known shapes and
 * log the raw payload keys when nothing matches so the mapping is easy to
 * confirm once a real token is in place. Adjust `extractRtmp()` if your plan
 * exposes them differently.
 *
 * Docs: https://developer.vimeo.com/api/live/events
 */
@Injectable()
export class VimeoService {
  private readonly logger = new Logger('VimeoService');
  private readonly base = 'https://api.vimeo.com';

  constructor(private readonly config: ConfigService) {}

  private get token(): string {
    const token = this.config.get<string>('vimeo.accessToken');
    if (!token) {
      throw new ServiceUnavailableException(
        'Vimeo is not configured. Set VIMEO_ACCESS_TOKEN in the backend .env to enable live classes.',
      );
    }
    return token;
  }

  private get headers(): Record<string, string> {
    const version = this.config.get<string>('vimeo.apiVersion') || '3.4';
    return {
      Authorization: `bearer ${this.token}`,
      Accept: `application/vnd.vimeo.*+json;version=${version}`,
      'Content-Type': 'application/json',
    };
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err: any) {
      this.logger.error(`Vimeo request failed: ${err?.message}`);
      throw new BadGatewayException('Could not reach Vimeo.');
    }

    const text = await res.text();
    const data = text ? safeJson(text) : null;

    if (!res.ok) {
      const detail =
        data?.error ||
        data?.developer_message ||
        res.statusText ||
        'Unknown error';
      this.logger.error(`Vimeo ${method} ${path} -> ${res.status}: ${detail}`);
      throw new BadGatewayException(`Vimeo error (${res.status}): ${detail}`);
    }

    return data;
  }

  /** Create a live event and return normalized broadcast credentials. */
  async createLiveEvent(title: string): Promise<VimeoLiveEvent> {
    const created = await this.request('POST', '/me/live_events', {
      title,
      // Auto-name each broadcast so the tutor doesn't have to.
      automatically_title_stream: true,
      // Broadcast-only tutoring session; keep the VOD replay unlisted by default.
      privacy: { view: 'unlisted' },
    });

    const eventId = extractEventId(created);
    if (!eventId) {
      this.logger.error(
        `Vimeo create returned no event id. Keys: ${Object.keys(created || {}).join(', ')}`,
      );
      throw new BadGatewayException('Vimeo did not return a live event id.');
    }

    // RTMP credentials may not be present on the create response; fetch the
    // event once more to be sure we have them.
    const full = await this.getLiveEventRaw(eventId).catch(() => created);
    const rtmp = extractRtmp(full) || extractRtmp(created);

    return {
      eventId,
      rtmpUrl: rtmp?.url ?? null,
      streamKey: rtmp?.key ?? null,
      embedUrl: `https://vimeo.com/event/${eventId}/embed`,
    };
  }

  /** Re-fetch normalized credentials for an existing event. */
  async getLiveEvent(eventId: string): Promise<VimeoLiveEvent> {
    const raw = await this.getLiveEventRaw(eventId);
    const rtmp = extractRtmp(raw);
    return {
      eventId,
      rtmpUrl: rtmp?.url ?? null,
      streamKey: rtmp?.key ?? null,
      embedUrl: `https://vimeo.com/event/${eventId}/embed`,
    };
  }

  private getLiveEventRaw(eventId: string): Promise<any> {
    return this.request('GET', `/me/live_events/${eventId}`);
  }

  /** Delete a live event (called when a class is cancelled/removed). */
  async deleteLiveEvent(eventId: string): Promise<void> {
    try {
      await this.request('DELETE', `/me/live_events/${eventId}`);
    } catch (err: any) {
      // Non-fatal: log and move on so class deletion never blocks on Vimeo.
      this.logger.warn(
        `Failed to delete Vimeo event ${eventId}: ${err?.message}`,
      );
    }
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Vimeo returns `uri: "/live_events/12345"`; pull the trailing id. */
function extractEventId(obj: any): string | null {
  if (!obj) return null;
  if (typeof obj.uri === 'string') {
    const parts = obj.uri.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  }
  return obj.id ? String(obj.id) : null;
}

/**
 * Pull the RTMP(S) ingest URL + stream key out of whatever shape the event
 * resource uses. Covers the field names seen across Vimeo API versions/plans.
 */
function extractRtmp(obj: any): { url: string; key: string } | null {
  if (!obj) return null;

  const url =
    obj.rtmps_link ||
    obj.rtmp_link ||
    obj.streamable?.rtmps_link ||
    obj.streamable?.rtmp_link ||
    obj.embed?.rtmps_link ||
    null;

  const key =
    obj.stream_key ||
    obj.key ||
    obj.streamable?.stream_key ||
    obj.streamable?.key ||
    null;

  if (url && key) return { url, key };
  return null;
}
