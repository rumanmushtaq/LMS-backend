import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SessionService } from './session.service';
import { Session, SessionDocument } from '../schemas/session.schema';
import { hashToken } from '../../common/utils/crypto.util';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const ABSOLUTE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000; // 1 minute

/**
 * Minimal stand-in for a Mongoose session document. Only the fields the service
 * actually reads are modelled, so a test failure points at real logic rather
 * than at an incomplete mock.
 */
function makeSession(overrides: Partial<Session> = {}): SessionDocument {
  const now = new Date();
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    refreshTokenHash: null,
    lastActivityAt: now,
    absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_LIFETIME_MS),
    revokedAt: null,
    revokedReason: null,
    userAgent: null,
    ipAddress: null,
    ...overrides,
  } as unknown as SessionDocument;
}

describe('SessionService', () => {
  let service: SessionService;
  let model: {
    findById: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
  };

  /** Chainable `.exec()` shape that Mongoose queries return. */
  const exec = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });

  beforeEach(async () => {
    model = {
      findById: jest.fn(),
      updateOne: jest.fn().mockReturnValue(exec({ matchedCount: 1 })),
      updateMany: jest.fn().mockReturnValue(exec({ matchedCount: 1 })),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: getModelToken(Session.name), useValue: model },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                'session.idleTimeoutMs': IDLE_TIMEOUT_MS,
                'session.absoluteLifetimeMs': ABSOLUTE_LIFETIME_MS,
                'session.activityWriteIntervalMs': ACTIVITY_WRITE_INTERVAL_MS,
              })[key],
          },
        },
      ],
    }).compile();

    service = moduleRef.get<SessionService>(SessionService);
  });

  describe('assertActive — the idle timeout', () => {
    it('accepts a session that has just been used', async () => {
      const session = makeSession();
      model.findById.mockReturnValue(exec(session));

      await expect(service.assertActive(session._id.toString())).resolves.toBe(
        session,
      );
    });

    it('accepts a session idle for just under the timeout', async () => {
      const now = new Date();
      const session = makeSession({
        lastActivityAt: new Date(now.getTime() - (IDLE_TIMEOUT_MS - 1000)),
      });
      model.findById.mockReturnValue(exec(session));

      await expect(
        service.assertActive(session._id.toString(), now),
      ).resolves.toBe(session);
    });

    it('rejects a session idle for exactly the timeout', async () => {
      const now = new Date();
      const session = makeSession({
        lastActivityAt: new Date(now.getTime() - IDLE_TIMEOUT_MS),
      });
      model.findById.mockReturnValue(exec(session));

      await expect(
        service.assertActive(session._id.toString(), now),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('revokes the session when the idle timeout trips, so it cannot be reused', async () => {
      const now = new Date();
      const session = makeSession({
        lastActivityAt: new Date(now.getTime() - IDLE_TIMEOUT_MS - 1),
      });
      model.findById.mockReturnValue(exec(session));

      await expect(
        service.assertActive(session._id.toString(), now),
      ).rejects.toThrow(/inactivity/i);

      expect(model.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: session._id }),
        expect.objectContaining({
          $set: expect.objectContaining({ revokedReason: 'idle_timeout' }),
        }),
      );
    });

    it('rejects a revoked session', async () => {
      const session = makeSession({ revokedAt: new Date() });
      model.findById.mockReturnValue(exec(session));

      await expect(
        service.assertActive(session._id.toString()),
      ).rejects.toThrow(/revoked/i);
    });

    it('rejects a session past its absolute lifetime even when recently active', async () => {
      const now = new Date();
      const session = makeSession({
        lastActivityAt: now, // active *right now*
        absoluteExpiresAt: new Date(now.getTime() - 1),
      });
      model.findById.mockReturnValue(exec(session));

      await expect(
        service.assertActive(session._id.toString(), now),
      ).rejects.toThrow(UnauthorizedException);

      expect(model.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: session._id }),
        expect.objectContaining({
          $set: expect.objectContaining({ revokedReason: 'absolute_timeout' }),
        }),
      );
    });

    it('rejects a missing session', async () => {
      model.findById.mockReturnValue(exec(null));

      await expect(
        service.assertActive(new Types.ObjectId().toString()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token carrying no session id', async () => {
      await expect(service.assertActive(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('recordActivity — sliding expiration', () => {
    it('slides lastActivityAt forward once the write interval has passed', async () => {
      const now = new Date();
      const session = makeSession({
        lastActivityAt: new Date(
          now.getTime() - ACTIVITY_WRITE_INTERVAL_MS - 1,
        ),
      });

      await service.recordActivity(session, now);

      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: session._id, revokedAt: null },
        { $set: { lastActivityAt: now } },
      );
      expect(session.lastActivityAt).toBe(now);
    });

    it('coalesces writes inside the interval instead of hitting the database per request', async () => {
      const now = new Date();
      const session = makeSession({
        lastActivityAt: new Date(now.getTime() - 1000),
      });

      await service.recordActivity(session, now);

      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('will not resurrect a session revoked concurrently', async () => {
      const now = new Date();
      const session = makeSession({
        lastActivityAt: new Date(
          now.getTime() - ACTIVITY_WRITE_INTERVAL_MS - 1,
        ),
      });

      await service.recordActivity(session, now);

      // The `revokedAt: null` filter is what makes an in-flight activity write
      // lose to a logout that landed first.
      expect(model.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: null }),
        expect.anything(),
      );
    });

    it('keeps an active user signed in across repeated activity', async () => {
      // Simulates someone working steadily for an hour: each interaction is
      // well within the idle window, so the session never expires despite the
      // total elapsed time far exceeding 15 minutes.
      const start = new Date();
      const session = makeSession({ lastActivityAt: start });
      model.findById.mockReturnValue(exec(session));

      for (let minute = 10; minute <= 60; minute += 10) {
        const at = new Date(start.getTime() + minute * 60 * 1000);
        await expect(service.touch(session._id.toString(), at)).resolves.toBe(
          session,
        );
        expect(session.lastActivityAt).toEqual(at);
      }
    });
  });

  describe('rotateRefreshToken — refresh cannot outrun the idle timeout', () => {
    const presented = 'the-refresh-token';

    it('rotates for a session with recent activity', async () => {
      const session = makeSession({
        refreshTokenHash: hashToken(presented),
      });
      model.findById.mockReturnValue(exec(session));

      const issued = 'a-brand-new-refresh-token';
      const result = await service.rotateRefreshToken(
        session._id.toString(),
        presented,
        async () => issued,
      );

      expect(result.refreshToken).toBe(issued);
      expect(model.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: session._id, revokedAt: null }),
        expect.objectContaining({
          $set: expect.objectContaining({
            refreshTokenHash: hashToken(issued),
          }),
        }),
      );
    });

    it('refuses to revive a session idle beyond the timeout', async () => {
      const now = new Date();
      const session = makeSession({
        refreshTokenHash: hashToken(presented),
        lastActivityAt: new Date(now.getTime() - IDLE_TIMEOUT_MS - 1),
      });
      model.findById.mockReturnValue(exec(session));

      const issueNew = jest.fn();

      await expect(
        service.rotateRefreshToken(
          session._id.toString(),
          presented,
          issueNew,
          now,
        ),
      ).rejects.toThrow(/inactivity/i);

      // No token may be minted for an expired session.
      expect(issueNew).not.toHaveBeenCalled();
    });

    it('refuses a revoked session, so logout makes the refresh token useless', async () => {
      const session = makeSession({
        refreshTokenHash: hashToken(presented),
        revokedAt: new Date(),
      });
      model.findById.mockReturnValue(exec(session));

      const issueNew = jest.fn();

      await expect(
        service.rotateRefreshToken(session._id.toString(), presented, issueNew),
      ).rejects.toThrow(UnauthorizedException);
      expect(issueNew).not.toHaveBeenCalled();
    });

    it('treats replay of an already-rotated token as theft and kills every session', async () => {
      const session = makeSession({
        refreshTokenHash: hashToken('the-current-token'),
      });
      model.findById.mockReturnValue(exec(session));

      await expect(
        service.rotateRefreshToken(
          session._id.toString(),
          'a-previously-rotated-token',
          async () => 'never-issued',
        ),
      ).rejects.toThrow(/invalidated/i);

      expect(model.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: session.userId, revokedAt: null }),
        expect.objectContaining({
          $set: expect.objectContaining({ revokedReason: 'reuse_detected' }),
        }),
      );
    });

    it('loses the race when a concurrent refresh already rotated the token', async () => {
      const session = makeSession({
        refreshTokenHash: hashToken(presented),
      });
      model.findById.mockReturnValue(exec(session));
      model.updateOne.mockReturnValue(exec({ matchedCount: 0 }));

      await expect(
        service.rotateRefreshToken(
          session._id.toString(),
          presented,
          async () => 'issued-but-discarded',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('records the refresh itself as activity', async () => {
      const now = new Date();
      const session = makeSession({
        refreshTokenHash: hashToken(presented),
        lastActivityAt: new Date(now.getTime() - 5 * 60 * 1000),
      });
      model.findById.mockReturnValue(exec(session));

      await service.rotateRefreshToken(
        session._id.toString(),
        presented,
        async () => 'issued',
        now,
      );

      expect(model.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({ lastActivityAt: now }),
        }),
      );
    });
  });

  describe('revocation', () => {
    it('revokes a single session and clears its refresh token', async () => {
      const session = makeSession();

      await service.revoke(session, 'logout');

      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: session._id, revokedAt: null },
        expect.objectContaining({
          $set: expect.objectContaining({
            revokedReason: 'logout',
            refreshTokenHash: null,
          }),
        }),
      );
    });

    it('revokes every live session for a user on password change', async () => {
      const userId = new Types.ObjectId();

      await service.revokeAllForUser(userId, 'password_change');

      expect(model.updateMany).toHaveBeenCalledWith(
        { userId, revokedAt: null },
        expect.objectContaining({
          $set: expect.objectContaining({ revokedReason: 'password_change' }),
        }),
      );
    });
  });
});
