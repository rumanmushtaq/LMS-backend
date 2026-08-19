import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../../users/schemas/user.schema';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /**
   * Server-side session id. Both tokens carry it so every authenticated request
   * and every refresh can be checked against the session record, which is what
   * makes the idle timeout enforceable — a signed JWT alone cannot be revoked.
   *
   * Optional so tokens issued before this change fail closed at the session
   * lookup rather than crashing on a missing claim.
   */
  sid?: string;
  iat?: number;
  exp?: number;
}

export const CurrentUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
