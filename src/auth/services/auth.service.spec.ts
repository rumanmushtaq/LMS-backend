import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { User, UserRole, UserStatus } from '../../users/schemas/user.schema';
import { EmailService } from '../../email/services/email.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AutoBlockService } from '../../security/services/auto-block.service';
import { IpActivityService } from '../../security/services/ip-activity.service';

const ACCESS_SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';

/**
 * Exercises the session-aware auth flows against a real JwtService, so the
 * `sid` claim and the 15-minute `exp` are asserted on genuinely signed tokens
 * rather than on a mock's return value.
 */
describe('AuthService — sliding sessions', () => {
  let service: AuthService;
  let sessionService: jest.Mocked<Partial<SessionService>>;
  let jwtService: JwtService;
  let userModel: { findOne: jest.Mock; findById: jest.Mock };

  const sessionId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  const makeUser = (overrides: Record<string, unknown> = {}) =>
    ({
      _id: userId,
      email: 'student@example.com',
      firstName: 'Ada',
      role: UserRole.STUDENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      twoFactorEnabled: false,
      isDeleted: false,
      password: bcrypt.hashSync('correct-horse', 4),
      refreshTokenHash: null,
      lastLogin: null,
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    }) as any;

  beforeEach(async () => {
    jwtService = new JwtService({});

    userModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
    };

    sessionService = {
      createSession: jest.fn().mockResolvedValue({ _id: sessionId }),
      attachRefreshToken: jest.fn().mockResolvedValue(undefined),
      rotateRefreshToken: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: JwtService, useValue: jwtService },
        { provide: SessionService, useValue: sessionService },
        {
          provide: EmailService,
          useValue: {
            sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
            sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
            sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
            sendTwoFactorOTPEmail: jest.fn().mockResolvedValue(undefined),
            sendEmail: jest.fn().mockResolvedValue(true),
          },
        },
        // IP-reputation collaborators from the security module. Stubbed so
        // these tests stay about session lifetime, not credential stuffing.
        {
          provide: AutoBlockService,
          useValue: {
            recordFailedLogin: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: IpActivityService,
          useValue: { recordUser: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                'jwt.accessSecret': ACCESS_SECRET,
                'jwt.refreshSecret': REFRESH_SECRET,
                'jwt.accessExpiration': '15m',
                'jwt.refreshExpiration': '7d',
                'security.bcryptSaltRounds': 4,
                'security.twoFaAppName': 'VaronaAcademy',
              })[key],
          },
        },
      ],
    }).compile();

    service = moduleRef.get<AuthService>(AuthService);
  });

  const decodeAccess = (token: string): JwtPayload =>
    jwtService.verify(token, { secret: ACCESS_SECRET });

  describe('login', () => {
    it('opens a server-side session and binds the refresh token to it', async () => {
      const user = makeUser();
      userModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      });

      const result = await service.login({
        email: 'student@example.com',
        password: 'correct-horse',
      } as any);

      expect(sessionService.createSession).toHaveBeenCalledWith(
        userId,
        undefined,
      );
      expect(sessionService.attachRefreshToken).toHaveBeenCalledWith(
        sessionId,
        result.tokens!.refreshToken,
      );
    });

    it('issues an access token carrying the session id', async () => {
      const user = makeUser();
      userModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      });

      const result = await service.login({
        email: 'student@example.com',
        password: 'correct-horse',
      } as any);

      expect(decodeAccess(result.tokens!.accessToken).sid).toBe(
        sessionId.toString(),
      );
    });

    it('issues an access token that expires in 15 minutes', async () => {
      const user = makeUser();
      userModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      });

      const result = await service.login({
        email: 'student@example.com',
        password: 'correct-horse',
      } as any);

      const { iat, exp } = decodeAccess(result.tokens!.accessToken);
      expect(exp! - iat!).toBe(15 * 60);
    });

    it('records the user agent and IP on the session', async () => {
      const user = makeUser();
      userModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      });

      const context = { userAgent: 'Firefox', ipAddress: '203.0.113.7' };
      await service.login(
        { email: 'student@example.com', password: 'correct-horse' } as any,
        context,
      );

      expect(sessionService.createSession).toHaveBeenCalledWith(
        userId,
        context,
      );
    });

    it('rejects a wrong password without opening a session', async () => {
      const user = makeUser();
      userModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      });

      await expect(
        service.login({
          email: 'student@example.com',
          password: 'wrong',
        } as any),
      ).rejects.toThrow(UnauthorizedException);

      expect(sessionService.createSession).not.toHaveBeenCalled();
    });

    it('preserves the existing suspended-account check', async () => {
      const user = makeUser({ status: UserStatus.SUSPENDED });
      userModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      });

      await expect(
        service.login({
          email: 'student@example.com',
          password: 'correct-horse',
        } as any),
      ).rejects.toThrow(/suspended/i);
      expect(sessionService.createSession).not.toHaveBeenCalled();
    });

    it('preserves the existing unverified-email check', async () => {
      const user = makeUser({ emailVerified: false });
      userModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      });

      await expect(
        service.login({
          email: 'student@example.com',
          password: 'correct-horse',
        } as any),
      ).rejects.toThrow(/verify your email/i);
    });
  });

  describe('refreshTokens', () => {
    it('issues a NEW access token rather than editing the old one', async () => {
      const user = makeUser();

      (sessionService.rotateRefreshToken as jest.Mock).mockImplementation(
        async (_sid, _presented, issueNew) => ({
          session: { _id: sessionId },
          refreshToken: await issueNew(),
        }),
      );

      const first = await service.refreshTokens(
        user,
        'old-refresh',
        sessionId.toString(),
      );

      // A second refresh a moment later must produce a token with a later
      // expiry — proving the expiry slid by re-signing, not by mutating `exp`.
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const second = await service.refreshTokens(
        user,
        first.refreshToken,
        sessionId.toString(),
      );

      expect(second.accessToken).not.toBe(first.accessToken);
      expect(decodeAccess(second.accessToken).exp!).toBeGreaterThan(
        decodeAccess(first.accessToken).exp!,
      );
    });

    it('always issues 15 minutes from the moment of refresh', async () => {
      const user = makeUser();
      (sessionService.rotateRefreshToken as jest.Mock).mockImplementation(
        async (_sid, _presented, issueNew) => ({
          session: { _id: sessionId },
          refreshToken: await issueNew(),
        }),
      );

      const tokens = await service.refreshTokens(
        user,
        'old-refresh',
        sessionId.toString(),
      );

      const { iat, exp } = decodeAccess(tokens.accessToken);
      expect(exp! - iat!).toBe(15 * 60);
    });

    it('propagates the rejection when the session is idle-expired', async () => {
      const user = makeUser();
      (sessionService.rotateRefreshToken as jest.Mock).mockRejectedValue(
        new UnauthorizedException(
          'Session expired due to inactivity. Please log in again.',
        ),
      );

      await expect(
        service.refreshTokens(user, 'old-refresh', sessionId.toString()),
      ).rejects.toThrow(/inactivity/i);
    });

    it('keeps the session id stable across a refresh', async () => {
      const user = makeUser();
      (sessionService.rotateRefreshToken as jest.Mock).mockImplementation(
        async (_sid, _presented, issueNew) => ({
          session: { _id: sessionId },
          refreshToken: await issueNew(),
        }),
      );

      const tokens = await service.refreshTokens(
        user,
        'old-refresh',
        sessionId.toString(),
      );

      expect(decodeAccess(tokens.accessToken).sid).toBe(sessionId.toString());
    });
  });

  describe('logout', () => {
    it('revokes the session server-side', async () => {
      const user = makeUser();

      await service.logout(user, sessionId.toString());

      expect(sessionService.revoke).toHaveBeenCalledWith(
        sessionId.toString(),
        'logout',
      );
    });

    it('revokes only the calling session, not every device', async () => {
      const user = makeUser();

      await service.logout(user, sessionId.toString());

      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('password changes', () => {
    it('revokes every session when the password is changed', async () => {
      const user = makeUser();

      await service.changePassword(user, {
        currentPassword: 'correct-horse',
        newPassword: 'a-new-password',
      } as any);

      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        userId,
        'password_change',
      );
    });
  });
});
