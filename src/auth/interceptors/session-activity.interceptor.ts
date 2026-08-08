import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { SessionDocument } from '../schemas/session.schema';
import { SessionService } from '../services/session.service';
import { IS_PASSIVE_REQUEST_KEY } from '../../common/decorators/passive-request.decorator';

/**
 * Slides the session's idle window forward on meaningful user activity.
 *
 * Runs after the auth guard, so by the time it executes `JwtStrategy` has
 * already validated the session and attached it to the request. This only
 * records activity — it never decides whether the session is valid. That
 * separation matters: an endpoint marked `@PassiveRequest()` skips the slide
 * but is still fully authenticated and still subject to the idle check.
 */
@Injectable()
export class SessionActivityInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SessionActivityInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only HTTP carries the request-scoped session; websocket frames are
    // authenticated separately and must not be treated as user activity.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const isPassive = this.reflector.getAllAndOverride<boolean>(
      IS_PASSIVE_REQUEST_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isPassive) {
      const request = context
        .switchToHttp()
        .getRequest<{ session?: SessionDocument }>();

      if (request.session) {
        // Deliberately not awaited: sliding the window must not add latency to
        // the response, and the security decision was already made by the
        // guard. A lost write costs at most `activityWriteIntervalMs` of
        // resolution, which can only expire a session early, never late.
        void this.sessionService
          .recordActivity(request.session)
          .catch((error: Error) =>
            this.logger.warn(
              `Failed to record session activity: ${error.message}`,
            ),
          );
      }
    }

    return next.handle();
  }
}
