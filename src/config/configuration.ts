import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  name: process.env.APP_NAME || 'Varona Academy',
  url: process.env.APP_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
}));

export const databaseConfig = registerAs('database', () => ({
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/varona-academy',
}));

export const jwtConfig = registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
  refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
}));

/**
 * Sliding-session policy. Every duration lives here so the timeout is one
 * configurable value rather than a literal repeated across guards and services.
 */
export const sessionConfig = registerAs('session', () => ({
  /**
   * Idle window. No meaningful activity for this long ends the session, and no
   * refresh token can revive it. Kept in step with `jwt.accessExpiration` so an
   * access token never outlives the idle window it was issued under.
   */
  idleTimeoutMs: parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || '900000', 10),

  /**
   * Hard ceiling regardless of how active the user is. Continuous activity must
   * not keep one login alive forever. Defaults to 7 days, matching the previous
   * refresh-token lifetime so existing behaviour is not silently shortened.
   */
  absoluteLifetimeMs: parseInt(
    process.env.SESSION_ABSOLUTE_LIFETIME_MS || '604800000',
    10,
  ),

  /**
   * Write-coalescing window for `lastActivityAt`. Persisting on every request
   * would add a database write per API call for no security gain; the idle
   * window is 15 minutes, so resolution finer than this is wasted. Lowering it
   * costs writes, raising it makes a session expire up to this much early.
   */
  activityWriteIntervalMs: parseInt(
    process.env.SESSION_ACTIVITY_WRITE_INTERVAL_MS || '60000',
    10,
  ),
}));

export const emailConfig = registerAs('email', () => ({
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  fromEmail: process.env.SMTP_FROM_EMAIL || 'noreply@varona-academy.com',
  fromName: process.env.SMTP_FROM_NAME || 'Varona Academy',
  verificationExpiration: process.env.EMAIL_VERIFICATION_EXPIRATION || '24h',
  passwordResetExpiration: process.env.PASSWORD_RESET_EXPIRATION || '1h',
}));

export const throttleConfig = registerAs('throttle', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
  limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
}));

export const securityConfig = registerAs('security', () => ({
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10),
  twoFaAppName: process.env.TWO_FA_APP_NAME || 'VaronaAcademy',

  // ── IP blocking ──────────────────────────────────────────────────────────
  // Ships in shadow mode: blocks are computed and counted but nothing is
  // refused until SECURITY_ENFORCE=true. Flip it only after reviewing the
  // shadow "blocked" counters against real traffic.
  enforceIpBlocks: process.env.SECURITY_ENFORCE === 'true',
  // Only enable once Cloudflare fronts the API AND the origin firewall
  // admits Cloudflare's IP ranges exclusively — otherwise the header is
  // client-controlled and the whole system can be evaded or poisoned.
  trustCloudflare: process.env.SECURITY_TRUST_CLOUDFLARE === 'true',
  // Distinct accounts failing from one IP (IPv6: one /64) inside the window.
  // High on purpose: carrier-grade NAT puts thousands of users on one IPv4.
  failedLoginThreshold: parseInt(
    process.env.SECURITY_FAILED_LOGIN_THRESHOLD || '30',
    10,
  ),
  failedLoginWindowMinutes: parseInt(
    process.env.SECURITY_FAILED_LOGIN_WINDOW_MIN || '10',
    10,
  ),
  // First auto-block duration; repeat offenses escalate 1× → 4× → 24×.
  autoBlockBaseMinutes: parseInt(
    process.env.SECURITY_AUTOBLOCK_BASE_MINUTES || '15',
    10,
  ),
}));

export const imagekitConfig = registerAs('imagekit', () => ({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
}));

export const stripeConfig = registerAs('stripe', () => ({
  secretKey: process.env.STRIPE_SECRET_KEY,
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  // Without this the webhook cannot be verified, and an unverified webhook is
  // an open endpoint that lets anyone mark any payment as paid.
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
}));

export const vimeoConfig = registerAs('vimeo', () => ({
  // Personal access token from a Vimeo app with `create`/`edit`/`video_files`
  // scopes on a paid plan that has live streaming enabled.
  accessToken: process.env.VIMEO_ACCESS_TOKEN,
  // API version pinned for stable field shapes.
  apiVersion: process.env.VIMEO_API_VERSION || '3.4',
}));

export const ingestConfig = registerAs('ingest', () => ({
  // Binary for the browser->RTMP relay. Plain 'ffmpeg' when it is on PATH;
  // point at a static build otherwise.
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  // Where self-hosted live HLS playlists are written and served from.
  hlsDir: process.env.LIVE_HLS_DIR,
}));

export const liveConfig = registerAs('live', () => ({
  // Broadcast provider for NEW live classes: 'vimeo' (default) or 'youtube'.
  // Existing sessions always stay on the provider they were created with.
  provider: process.env.LIVE_PROVIDER || 'vimeo',
}));

export const youtubeConfig = registerAs('youtube', () => ({
  // OAuth client + offline refresh token for the platform's YouTube channel
  // (the channel must have live streaming enabled). Obtain the refresh token
  // with scripts/get-youtube-refresh-token.mjs.
  clientId: process.env.YOUTUBE_CLIENT_ID,
  clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
  refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
  // Live-only mode: delete the auto-archived VOD when the tutor ends the
  // class, so no replay outlives the session.
  deleteAfterEnd: process.env.YOUTUBE_DELETE_AFTER_END !== 'false',
}));

/**
 * PSE (Colombian bank transfer). Stripe cannot process PSE, so this points at
 * whichever Colombian PSP is chosen — Wompi, Mercado Pago, ePayco, PayU or
 * dLocal. PSE stays hidden from buyers until all three are set.
 */
export const pseConfig = registerAs('pse', () => ({
  provider: process.env.PSE_PROVIDER,
  apiKey: process.env.PSE_API_KEY,
  apiSecret: process.env.PSE_API_SECRET,
  webhookSecret: process.env.PSE_WEBHOOK_SECRET,
  baseUrl: process.env.PSE_BASE_URL,
}));
