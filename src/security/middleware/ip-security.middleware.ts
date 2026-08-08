import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { resolveClientIp } from '../../common/utils';
import { IpActivityService } from '../services/ip-activity.service';
import { IpBlockService } from '../services/ip-block.service';

/**
 * Runs before the JWT guard, so a blocked IP costs no token verification and
 * no user lookup.
 *
 * Two operating modes, switched by SECURITY_ENFORCE:
 * - shadow (default): would-be rejections are only counted, nothing is
 *   refused. Run this for a week or two on real traffic to prove the
 *   false-positive rate before turning enforcement on.
 * - enforce: blocked IPs get a bare 403 carrying an incident id (the block's
 *   own id) — enough for support to find the exact block, nothing an
 *   attacker can learn from.
 *
 * Everything here fails open: an internal error lets the request through.
 */
@Injectable()
export class IpSecurityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IpSecurityMiddleware.name);
  private readonly enforce: boolean;
  private readonly trustCloudflare: boolean;
  private readonly supportEmail: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly ipBlockService: IpBlockService,
    private readonly ipActivityService: IpActivityService,
  ) {
    this.enforce = this.configService.get<boolean>('security.enforceIpBlocks', false);
    this.trustCloudflare = this.configService.get<boolean>(
      'security.trustCloudflare',
      false,
    );
    this.supportEmail = this.configService.get<string>(
      'email.fromEmail',
      'support@varona-academy.com',
    );
  }

  use(req: Request, res: Response, next: NextFunction): void {
    try {
      const ip = resolveClientIp(
        { headers: req.headers, remoteAddress: req.ip },
        { trustCloudflare: this.trustCloudflare },
      );
      if (!ip) return next();

      // Stashed for anything downstream (auth service, controllers).
      (req as Request & { clientIp?: string }).clientIp = ip;

      const match = this.ipBlockService.findBlock(ip);
      if (!match) {
        this.ipActivityService.recordRequest(ip);
        return next();
      }

      this.ipActivityService.recordBlocked(ip);

      if (!this.enforce) {
        // Shadow mode: visible in the dashboard's "blocked" counters and
        // logs, invisible to the user.
        this.logger.warn(`[shadow] would block ${ip} (block ${match.blockId})`);
        return next();
      }

      res.status(403).json({
        statusCode: 403,
        message:
          'Access from your network has been restricted. If you believe this is a mistake, contact support and include the incident id.',
        incidentId: match.blockId,
        support: this.supportEmail,
      });
    } catch (error) {
      this.logger.error(`IP security check failed open: ${error.message}`);
      next();
    }
  }
}
