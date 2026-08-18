import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { JwtStrategy, RequestWithSession } from './jwt.strategy';
import { SessionService } from '../services/session.service';
import { UserRole, UserStatus } from '../../users/schemas/user.schema';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { SessionDocument } from '../schemas/session.schema';

/**
 * The strategy is the chokepoint every authenticated HTTP request passes
 * through, so these cover the two halves of the decision: the session must be
 * live, and the user must still be allowed in. Passport has already verified
 * the signature and `exp` before `validate` is reached — expiry of the token
 * itself is asserted separately, below.
 */
describe('JwtStrategy', () => {
  const sessionId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  let sessionService: { assertActive: jest.Mock };
  let userModel: { findById: jest.Mock };
  let strategy: JwtStrategy;

  const session = { _id: sessionId } as unknown as SessionDocument;

  const payload: JwtPayload = {
    sub: userId.toString(),
    email: 'student@example.com',
    role: UserRole.STUDENT,
    sid: sessionId.toString(),
  };

  const makeUser = (overrides: Record<string, unknown> = {}) => ({
    _id: userId,
    email: 'student@example.com',
    role: UserRole.STUDENT,
    status: UserStatus.ACTIVE,
    ...overrides,
  });

  const req = () => ({}) as RequestWithSession;

  beforeEach(() => {
    sessionService = { assertActive: jest.fn().mockResolvedValue(session) };
    userModel = { findById: jest.fn() };

    strategy = new JwtStrategy(
      {
        get: (key: string) =>
          key === 'jwt.accessSecret' ? 'test-access-secret' : undefined,
      } as unknown as ConfigService,
      userModel as never,
      sessionService as unknown as SessionService,
    );
  });

  describe('valid access token', () => {
    it('returns the user when the session is live', async () => {
      const user = makeUser();
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      });

      await expect(strategy.validate(req(), payload)).resolves.toBe(user);
    });

    it('attaches the session so activity can be recorded without a second read', async () => {
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeUser()),
      });

      const request = req();
      await strategy.validate(request, payload);

      expect(request.session).toBe(session);
    });

    it('checks the session before loading the user', async () => {
      sessionService.assertActive.mockRejectedValue(
        new UnauthorizedException('Session expired due to inactivity.'),
      );

      await expect(strategy.validate(req(), payload)).rejects.toThrow(
        UnauthorizedException,
      );

      // No point paying for a user lookup on a dead session.
      expect(userModel.findById).not.toHaveBeenCalled();
    });
  });

  describe('idle and revoked sessions', () => {
    it('rejects when the session is idle past the timeout', async () => {
      sessionService.assertActive.mockRejectedValue(
        new UnauthorizedException(
          'Session expired due to inactivity. Please log in again.',
        ),
      );

      await expect(strategy.validate(req(), payload)).rejects.toThrow(
        /inactivity/i,
      );
    });

    it('rejects a token whose session was revoked by logout', async () => {
      sessionService.assertActive.mockRejectedValue(
        new UnauthorizedException('Session has been revoked'),
      );

      await expect(strategy.validate(req(), payload)).rejects.toThrow(
        /revoked/i,
      );
    });

    it('fails closed for a legacy token carrying no session id', async () => {
      sessionService.assertActive.mockRejectedValue(
        new UnauthorizedException('Session is no longer valid'),
      );

      const { sid: _sid, ...legacyPayload } = payload;

      await expect(
        strategy.validate(req(), legacyPayload as JwtPayload),
      ).rejects.toThrow(UnauthorizedException);
      expect(sessionService.assertActive).toHaveBeenCalledWith(undefined);
    });
  });

  describe('existing authorization checks are preserved', () => {
    it('rejects a deleted or missing user even with a live session', async () => {
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(strategy.validate(req(), payload)).rejects.toThrow(
        /user not found/i,
      );
    });

    it('rejects a suspended account', async () => {
      userModel.findById.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue(makeUser({ status: UserStatus.SUSPENDED })),
      });

      await expect(strategy.validate(req(), payload)).rejects.toThrow(
        /suspended/i,
      );
    });

    it('rejects a pending non-tutor account', async () => {
      userModel.findById.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue(
            makeUser({ status: UserStatus.PENDING, role: UserRole.STUDENT }),
          ),
      });

      await expect(strategy.validate(req(), payload)).rejects.toThrow(
        /verify your email/i,
      );
    });

    it('still admits a pending tutor, who is mid-onboarding by design', async () => {
      const tutor = makeUser({
        status: UserStatus.PENDING,
        role: UserRole.TUTOR,
      });
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(tutor),
      });

      await expect(strategy.validate(req(), payload)).resolves.toBe(tutor);
    });
  });

  describe('access token expiration', () => {
    it('is configured to reject expired tokens rather than ignore them', () => {
      // `validate` is never reached for an expired token — passport-jwt rejects
      // it first. What must hold is that expiry checking is switched on; the
      // sliding behaviour depends on expired tokens actually being refused so
      // the client is driven into the refresh flow.
      const built = new JwtStrategy(
        {
          get: (key: string) =>
            key === 'jwt.accessSecret' ? 'test-access-secret' : undefined,
        } as unknown as ConfigService,
        userModel as never,
        sessionService as unknown as SessionService,
      );

      expect(built).toBeInstanceOf(JwtStrategy);
      // Guards against someone "fixing" a 401 by flipping ignoreExpiration on.
      const source = JwtStrategy.toString();
      expect(source).not.toMatch(/ignoreExpiration:\s*true/);
    });
  });
});
