# YouTube Live as a broadcast provider for live classes

**Date:** 2026-09-01 · **Branch:** `feat/youtube-live` (from `main`) · **Scope:** backend only.

## Goal

Let live classes broadcast through **YouTube Live (unlisted)** instead of Vimeo,
selected by configuration, without changing the client contract: tutors still get
`rtmpUrl`/`streamKey` (or stream from OBS), students still get an `embedUrl`
iframe, and the Q&A conversation is untouched. Known trade-off (accepted after
discussion): unlisted links are shareable and the player carries YouTube
branding — this targets free/open classes; token-gated WebRTC remains the plan
for strictly paid ones.

## Design

- **`YouTubeService`** (`src/youtube/`) mirrors `VimeoService`: plain `fetch`,
  Nest exceptions, no `googleapis` dependency.
  - Auth: OAuth **refresh token** for one platform channel
    (`YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN`); access tokens fetched from
    `oauth2.googleapis.com/token` and cached until ~1 min before expiry.
  - `createLiveEvent(title)`: insert an **unlisted** `liveBroadcast`
    (`enableAutoStart`/`enableAutoStop` so no transition polling,
    `latencyPreference: ultraLow`, DVR off, not made-for-kids) + an RTMP
    `liveStream` (variable res/fps), bind them, return
    `{ broadcastId, streamId, rtmpUrl, streamKey, embedUrl }`
    (`embedUrl = youtube.com/embed/<broadcastId>?autoplay=1&rel=0`).
  - `getLiveEvent(broadcastId, streamId)`: re-read ingest credentials.
  - `endLiveEvent(broadcastId)`: transition to `complete` (tolerating
    already-ended/redundant errors) and, when `YOUTUBE_DELETE_AFTER_END`
    (default **on**, per the live-only/no-replay requirement), delete the
    auto-archived video.
  - `deleteLiveEvent(broadcastId, streamId)`: best-effort cleanup on class
    cancellation, mirroring Vimeo's swallow-and-log behaviour.
- **`LiveStreamingService`** facade (`src/live/`) chosen by `LIVE_PROVIDER`
  (`vimeo` default — non-breaking): `provision(title)`, `refresh(live)`,
  `end(live)`, `teardown(live)`, `hasEvent(live)`, `providerOf(live)`.
  `end`/`teardown` never throw (a provider hiccup must not block ending or
  cancelling a class). Per-session routing uses the **session's own**
  `provider` (legacy documents without one are Vimeo), so flipping the global
  config never strands an in-flight class.
- **Schema**: `LiveSession` gains `provider` (`vimeo`|`youtube`, default
  `vimeo`), `youtubeBroadcastId`, `youtubeStreamId`. Secrets handling
  unchanged (`rtmpUrl`/`streamKey` still stripped from serialized output).
- **`ClassesService`** swaps its direct `VimeoService` dependency for the
  facade; `setupLive`, `startLive`'s guard, `endLive`, and both teardown paths
  (cancel/remove) go through it. `endLive` additionally calls `end(live)`.
- **Config**: `LIVE_PROVIDER`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`,
  `YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_DELETE_AFTER_END` — all optional so the app
  boots without them; YouTube calls fail with a clear message when unset
  (same pattern as Vimeo). A helper script
  (`scripts/get-youtube-refresh-token.mjs`) obtains the channel refresh token
  via a loopback OAuth flow.

## Out of scope

Frontend changes (the existing iframe embed renders a YouTube embed URL as-is),
per-student gating (separate WebRTC track), migrating existing Vimeo sessions.

## Testing

Jest unit specs, written first: `youtube.service.spec.ts` (mocked `fetch`:
credential errors, unlisted+auto-start payloads, token caching, end/delete
semantics), `live-streaming.service.spec.ts` (provider routing, legacy
defaults, never-throw teardown/end), `classes.live-provider.spec.ts`
(setupLive stores provider ids, refresh path, endLive calls the facade).
Existing classes specs updated for the facade dependency. Full suite +
`npm run build` green before push.
