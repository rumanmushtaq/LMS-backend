import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

/** What the refresh route receives via `@CurrentUser()`. */
export interface RefreshContext {
  user: UserDocument;
  refreshToken: string;
  sessionId: string;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.refreshSecret'),
      passReqToCallback: true,
    });
  }

  /**
   * Establishes only *who* is asking and *which* session.
   *
   * The idle check, revocation check and reuse detection deliberately live in
   * `AuthService.refreshTokens` rather than here, so there is a single place
   * where a refresh can be rejected — and so the checks run in a guaranteed
   * order against the session record.
   */
  async validate(
    req: Request,
    payload: JwtPayload,
  ): Promise<RefreshContext> {
    const refreshToken = (req.body as { refreshToken?: string })?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    // Tokens minted before sessions existed carry no `sid`. Fail closed rather
    // than falling back to the old user-level refresh hash, which had no idle
    // enforcement at all.
    if (!payload.sid) {
      throw new UnauthorizedException(
        'Session expired. Please log in again.',
      );
    }

    const user = await this.userModel.findById(payload.sub).exec();

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return { user, refreshToken, sessionId: payload.sid };
  }
}
