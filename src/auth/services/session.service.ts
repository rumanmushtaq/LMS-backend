import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Session, SessionDocument } from '../schemas/session.schema';
import { hashToken, verifyToken } from '../../common/utils/crypto.util';

/** Why a session was ended. Stored for audit and surfaced in logs. */
export type RevokeReason =
  | 'logout'
  | 'idle_timeout'
  | 'absolute_timeout'
  | 'reuse_detected'
  | 'password_change';

/**
 * Owns the server-side session lifecycle.
 *
 * This service is the single authority on whether a login is still alive. The
 * access token proves *who* the caller is; only this service decides whether
 * that identity may still act. Nothing here trusts a client-supplied timestamp.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  private readonly idleTimeoutMs: number;
  private readonly absoluteLifetimeMs: number;
  private readonly activityWriteIntervalMs: number;

  constructor(
    @InjectModel(Session.name)
    private readonly sessionModel: Model<SessionDocument>,
    private readonly configService: ConfigService,
  ) {
    this.idleTimeoutMs = this.configService.get<number>(
      'session.idleTimeoutMs',
    )!;
    this.absoluteLifetimeMs = this.configService.get<number>(
      'session.absoluteLifetimeMs',
    )!;
    this.activityWriteIntervalMs = this.configService.get<number>(
      'session.activityWriteIntervalMs',
    )!;
  }

  /** Creates a session for a fresh login. Returns the document so callers can read its id. */
  async createSession(
    userId: string | Types.ObjectId,
    context?: { userAgent?: string | null; ipAddress?: string | null },
  ): Promise<SessionDocument> {
    const now = new Date();

    const session = new this.sessionModel({
      userId: new Types.ObjectId(userId.toString()),
      lastActivityAt: now,
      absoluteExpiresAt: new Date(now.getTime() + this.absoluteLifetimeMs),
      refreshTokenHash: null,
      revokedAt: null,
      userAgent: context?.userAgent ?? null,
      ipAddress: context?.ipAddress ?? null,
    });

    return session.save();
  }

  /** Binds a newly issued refresh token to a session, replacing any previous one. */
  async attachRefreshToken(
    sessionId: string | Types.ObjectId,
    refreshToken: string,
  ): Promise<void> {
    await this.sessionModel
      .updateOne(
        { _id: new Types.ObjectId(sessionId.toString()) },
        { $set: { refreshTokenHash: hashToken(refreshToken) } },
      )
      .exec();
  }

  /**
   * Resolves a session id and asserts the session may still be used.
   *
   * Order matters: revocation first (cheapest and most definitive), then the
   * absolute ceiling, then idle. Any failure revokes the record so a later
   * request cannot re-evaluate it differently.
   */
  async assertActive(
    sessionId: string | undefined | null,
    now: Date = new Date(),
  ): Promise<SessionDocument> {
    if (!sessionId || !Types.ObjectId.isValid(sessionId)) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    const session = await this.sessionModel
      .findById(new Types.ObjectId(sessionId))
      .exec();

    if (!session) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (session.revokedAt) {
      throw new UnauthorizedException('Session has been revoked');
    }

    if (session.absoluteExpiresAt.getTime() <= now.getTime()) {
      await this.revoke(session, 'absolute_timeout');
      throw new UnauthorizedException(
        'Session has expired. Please log in again.',
      );
    }

    if (this.isIdle(session, now)) {
      await this.revoke(session, 'idle_timeout');
      throw new UnauthorizedException(
        'Session expired due to inactivity. Please log in again.',
      );
    }

    return session;
  }

  /**
   * Asserts the session is usable, then slides `lastActivityAt` forward.
   *
   * The write is coalesced: if the stored timestamp is newer than
   * `activityWriteIntervalMs` the update is skipped, so a burst of API calls
   * costs one write rather than one per call. The idle check above always uses
   * the persisted value, so coalescing can only ever expire a session slightly
   * early — never keep a dead one alive.
   */
  async touch(
    sessionId: string | undefined | null,
    now: Date = new Date(),
  ): Promise<SessionDocument> {
    const session = await this.assertActive(sessionId, now);
    await this.recordActivity(session, now);
    return session;
  }

  /**
   * Slides `lastActivityAt` on a session that has *already* been validated.
   *
   * Split out from `touch` so the request path reads the session once — the
   * strategy validates it, the activity interceptor records against that same
   * document — rather than paying a second lookup per API call.
   */
  async recordActivity(
    session: SessionDocument,
    now: Date = new Date(),
  ): Promise<void> {
    const sinceLastWrite = now.getTime() - session.lastActivityAt.getTime();
    if (sinceLastWrite < this.activityWriteIntervalMs) {
      return;
    }

    // Conditioned on the session still being live so a concurrent logout or
    // revocation cannot be undone by an in-flight activity update.
    await this.sessionModel
      .updateOne(
        { _id: session._id, revokedAt: null },
        { $set: { lastActivityAt: now } },
      )
      .exec();

    session.lastActivityAt = now;
  }

  /**
   * Validates a refresh attempt and rotates the stored token hash.
   *
   * The idle check runs *before* anything is issued, which is what stops a
   * refresh token from reviving a session the user abandoned. Because of that
   * ordering, treating the refresh itself as activity is safe.
   */
  async rotateRefreshToken(
    sessionId: string | undefined | null,
    presentedRefreshToken: string,
    issueNewRefreshToken: () => Promise<string>,
    now: Date = new Date(),
  ): Promise<{ session: SessionDocument; refreshToken: string }> {
    const session = await this.assertActive(sessionId, now);

    if (!session.refreshTokenHash) {
      await this.revoke(session, 'reuse_detected');
      throw new UnauthorizedException('Invalid refresh token');
    }

    // A token that verified as a JWT but does not match the stored hash is an
    // already-rotated token being replayed. Treat it as theft: kill every
    // session for this user, since we cannot tell attacker from victim.
    if (!verifyToken(presentedRefreshToken, session.refreshTokenHash)) {
      await this.revokeAllForUser(session.userId, 'reuse_detected');
      this.logger.warn(
        `Refresh token reuse detected for user ${session.userId.toString()} — all sessions revoked`,
      );
      throw new UnauthorizedException(
        'Invalid refresh token - session invalidated',
      );
    }

    const refreshToken = await issueNewRefreshToken();

    const result = await this.sessionModel
      .updateOne(
        {
          _id: session._id,
          revokedAt: null,
          // Guards against two concurrent refreshes both rotating: only the
          // one still holding the current hash wins.
          refreshTokenHash: session.refreshTokenHash,
        },
        {
          $set: {
            refreshTokenHash: hashToken(refreshToken),
            lastActivityAt: now,
          },
        },
      )
      .exec();

    if (result.matchedCount === 0) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    session.refreshTokenHash = hashToken(refreshToken);
    session.lastActivityAt = now;

    return { session, refreshToken };
  }

  /** Revokes one session. Idempotent. */
  async revoke(
    session: SessionDocument | string | Types.ObjectId,
    reason: RevokeReason,
    now: Date = new Date(),
  ): Promise<void> {
    const id =
      typeof session === 'string' || session instanceof Types.ObjectId
        ? new Types.ObjectId(session.toString())
        : session._id;

    await this.sessionModel
      .updateOne(
        { _id: id, revokedAt: null },
        {
          $set: {
            revokedAt: now,
            revokedReason: reason,
            refreshTokenHash: null,
          },
        },
      )
      .exec();

    if (typeof session !== 'string' && !(session instanceof Types.ObjectId)) {
      session.revokedAt = now;
      session.revokedReason = reason;
      session.refreshTokenHash = null;
    }
  }

  /** Revokes every live session for a user — password change, or suspected theft. */
  async revokeAllForUser(
    userId: string | Types.ObjectId,
    reason: RevokeReason,
    now: Date = new Date(),
  ): Promise<void> {
    await this.sessionModel
      .updateMany(
        { userId: new Types.ObjectId(userId.toString()), revokedAt: null },
        {
          $set: {
            revokedAt: now,
            revokedReason: reason,
            refreshTokenHash: null,
          },
        },
      )
      .exec();
  }

  /** True once the idle window has elapsed since the last meaningful activity. */
  private isIdle(session: SessionDocument, now: Date): boolean {
    return (
      now.getTime() - session.lastActivityAt.getTime() >= this.idleTimeoutMs
    );
  }
}
