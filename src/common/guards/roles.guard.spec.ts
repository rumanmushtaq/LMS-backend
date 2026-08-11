import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../users/schemas/user.schema';

/**
 * The security admin controller is decorated @Roles(UserRole.ADMIN), so this
 * guard is the single gate deciding non-admin -> 403. Covered here directly
 * because the live path can't be exercised without a full admin login session.
 */
describe('RolesGuard', () => {
  const makeContext = (user: any, requiredRoles?: UserRole[]) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    } as any;
    const context = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
    return { guard: new RolesGuard(reflector), context };
  };

  it('allows an admin into an admin-only route', () => {
    const { guard, context } = makeContext({ role: UserRole.ADMIN }, [
      UserRole.ADMIN,
    ]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies a tutor from an admin-only route (403)', () => {
    const { guard, context } = makeContext({ role: UserRole.TUTOR }, [
      UserRole.ADMIN,
    ]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('denies a student from an admin-only route (403)', () => {
    const { guard, context } = makeContext({ role: UserRole.STUDENT }, [
      UserRole.ADMIN,
    ]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('denies when no user is attached to the request', () => {
    const { guard, context } = makeContext(undefined, [UserRole.ADMIN]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('is a no-op when a route declares no roles', () => {
    const { guard, context } = makeContext({ role: UserRole.STUDENT }, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });
});
