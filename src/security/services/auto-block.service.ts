import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { blockKeyForIp, normalizeIp } from '../../common/utils';
import { User, UserDocument, UserRole } from '../../users/schemas/user.schema';
import { NotificationsService } from '../../notifications/notifications.service';
import { BlockType } from '../schemas/blocked-ip.schema';
import { IpActivityService } from './ip-activity.service';
import { IpBlockService } from './ip-block.service';

interface FailureWindow {
  /** timestamp -> account identifier (lowercased email) */
  attempts: Array<{ at: number; account: string }>;
}

/**
 * Credential-stuffing detector. The signal is deliberately *distinct accounts
 * per IP*, not raw failure count: one student mistyping their own password
 * twenty times is a Layer-1 (per-account lockout) concern, while one IP
 * walking through thirty different emails is an attack no legitimate NAT
 * produces. That distinction is what keeps this safe behind carrier-grade
 * NAT, where a single IPv4 can front an entire city of real users.
 *
 * Auto-blocks are always temporary and escalate 15m → 1h → 6h. Only a human
 * may block permanently.
 */
@Injectable()
export class AutoBlockService {
  private readonly logger = new Logger(AutoBlockService.name);
  private windows = new Map<string, FailureWindow>();

  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly baseBlockMinutes: number;

  private static readonly ESCALATION_MULTIPLIERS = [1, 4, 24]; // 15m, 1h, 6h

  constructor(
    private readonly configService: ConfigService,
    private readonly ipBlockService: IpBlockService,
    private readonly ipActivityService: IpActivityService,
    private readonly notificationsService: NotificationsService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    this.threshold = this.configService.get<number>(
      'security.failedLoginThreshold',
      30,
    );
    this.windowMs =
      this.configService.get<number>('security.failedLoginWindowMinutes', 10) *
      60_000;
    this.baseBlockMinutes = this.configService.get<number>(
      'security.autoBlockBaseMinutes',
      15,
    );
  }

  /**
   * Called from the auth service on every failed credential check.
   * Fire-and-forget: a failure here must never affect the login response.
   */
  recordFailedLogin(ip: string | undefined, account: string): void {
    try {
      const normalized = normalizeIp(ip);
      if (!normalized) return;

      this.ipActivityService.recordFailedLogin(normalized);

      const key = blockKeyForIp(normalized);
      if (!key || this.ipBlockService.isWhitelisted(normalized)) return;

      const now = Date.now();
      const window = this.windows.get(key) ?? { attempts: [] };
      window.attempts = window.attempts.filter(
        (a) => now - a.at < this.windowMs,
      );
      window.attempts.push({ at: now, account: account.toLowerCase() });
      this.windows.set(key, window);

      const distinctAccounts = new Set(window.attempts.map((a) => a.account));
      if (distinctAccounts.size >= this.threshold) {
        this.windows.delete(key);
        void this.applyAutoBlock(normalized, key, distinctAccounts.size);
      }
    } catch (error) {
      this.logger.error(`recordFailedLogin failed: ${error.message}`);
    }
  }

  private async applyAutoBlock(
    ip: string,
    key: string,
    accountCount: number,
  ): Promise<void> {
    try {
      const priorBlocks = await this.ipBlockService.countRecentAutoBlocks(
        key,
        new Date(Date.now() - 7 * 24 * 3600_000),
      );
      const multiplier =
        AutoBlockService.ESCALATION_MULTIPLIERS[
          Math.min(
            priorBlocks,
            AutoBlockService.ESCALATION_MULTIPLIERS.length - 1,
          )
        ];
      const minutes = this.baseBlockMinutes * multiplier;
      const reason = `Failed logins across ${accountCount} distinct accounts within ${Math.round(
        this.windowMs / 60_000,
      )} minutes (offense #${priorBlocks + 1} this week)`;

      await this.ipBlockService.block({
        ipOrCidr: ip,
        reason,
        type: BlockType.AUTO,
        actor: 'system',
        actorName: 'System',
        expiresAt: new Date(Date.now() + minutes * 60_000),
      });

      this.logger.warn(`Auto-blocked ${key} for ${minutes}m: ${reason}`);
      await this.notifyAdmins(key, reason, minutes);
    } catch (error) {
      this.logger.error(`Auto-block of ${key} failed: ${error.message}`);
    }
  }

  /**
   * Auto-actions that happen silently erode trust in the system, so every
   * auto-block lands in each admin's notification feed for review.
   */
  private async notifyAdmins(
    key: string,
    reason: string,
    minutes: number,
  ): Promise<void> {
    try {
      const admins = await this.userModel
        .find({ role: UserRole.ADMIN, isDeleted: { $ne: true } })
        .select('_id')
        .lean();

      await Promise.all(
        admins.map((admin) =>
          this.notificationsService.create({
            userId: String(admin._id),
            type: 'security',
            title: `System blocked ${key} for ${minutes} minutes`,
            content: reason,
            actionPayload: { kind: 'ip_auto_block', key },
          }),
        ),
      );
    } catch (error) {
      this.logger.error(`Admin notification failed: ${error.message}`);
    }
  }
}
