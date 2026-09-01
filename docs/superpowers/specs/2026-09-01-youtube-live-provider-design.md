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

## Addendum (2026-09-01): browser broadcasting — no OBS

Teachers stream straight from the laptop camera; the browser cannot speak
RTMP, so the backend relays: `getUserMedia` + `MediaRecorder` (webm, 1s
chunks) → Socket.IO namespace `/ingest` (binary) → one **ffmpeg** process per
live class → RTMP(S) to the class's provisioned `rtmpUrl`/`streamKey` (works
for YouTube and Vimeo alike).

- `src/ingest/ffmpeg-args.ts` (pure, tested): H.264 camera tracks are
  **copied** (cheap); VP8/VP9 fall back to `libx264 veryfast/zerolatency`
  (~1 core per live class). Audio always Opus→AAC. Output `-f flv`.
- `src/ingest/ingest.service.ts` (tested with a fake spawner): one session
  per class, tutor-only (ownership re-checked on every chunk), replace-on-
  restart, graceful stop (stdin end → kill after grace), stderr tail carried
  into error events, `FFMPEG_PATH` configurable, missing ffmpeg surfaces a
  clear error.
- `src/ingest/ingest.gateway.ts`: same handshake auth as the chat gateway
  (JWT + active session + IP blocklist); events `startIngest` /
  `ingestChunk` / `stopIngest`, cleanup on disconnect; 8 MB socket buffer.
- LMS-web: `useBrowserBroadcast` hook (camera/mic capture, mime pick with
  H.264 preference, chunk pump, teardown) + a "Broadcast from this device"
  card on the tutor live page; OBS credentials remain as the advanced path.
