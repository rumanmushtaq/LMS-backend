import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  User,
  UserDocument,
  UserStatus,
  UserRole,
} from '../../users/schemas/user.schema';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { SessionService } from '../services/session.service';
import { SessionDocument } from '../schemas/session.schema';

/** The request, once this strategy has attached the validated session to it. */
export type RequestWithSession = Request & { session?: SessionDocument };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly sessionService: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.accessSecret'),
      passReqToCallback: true,
    });
  }

  /**
   * A valid signature is necessary but not sufficient.
   *
   * The access token is stateless and cannot be withdrawn once signed, so the
   * session record is consulted on every request. `assertActive` throws — and
   * revokes — if the session was logged out, has passed its absolute ceiling,
   * or has been idle beyond the configured window. This is what makes the
   * server, not the client, the authority on session expiry.
   */
  async validate(
    req: RequestWithSession,
    payload: JwtPayload,
  ): Promise<UserDocument> {
    const session = await this.sessionService.assertActive(payload.sid);

    const user = await this.userModel.findById(payload.sub).exec();

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account is suspended');
    }

    if (user.status === UserStatus.PENDING && user.role !== UserRole.TUTOR) {
      throw new UnauthorizedException('Please verify your email first');
    }

    // Handed to SessionActivityInterceptor so sliding the idle window costs no
    // second database read.
    req.session = session;

    return user;
  }
}
