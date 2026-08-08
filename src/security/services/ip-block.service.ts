import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  blockKeyForIp,
  cidrContains,
  normalizeIp,
  parseCidr,
  ParsedCidr,
} from '../../common/utils';
import {
  BlockedIp,
  BlockedIpDocument,
  BlockType,
} from '../schemas/blocked-ip.schema';
import {
  IpWhitelist,
  IpWhitelistDocument,
} from '../schemas/ip-whitelist.schema';
import {
  SecurityAudit,
  SecurityAuditAction,
  SecurityAuditDocument,
} from '../schemas/security-audit.schema';

interface CachedRange {
  cidr: ParsedCidr;
  blockId: string;
}

export interface BlockMatch {
  blockId: string;
  key: string;
}

/**
 * The blocklist consulted on every request, so the hot path touches memory
 * only: an exact-key Set plus a small parsed-CIDR list, refreshed from Mongo
 * on an interval and immediately after any mutation. The refresh interval is
 * also what keeps multiple PM2 instances converging on the same view.
 *
 * Fail-open is deliberate: if Mongo is unreachable the last good cache keeps
 * serving and lookups never throw. A blocklist outage must degrade to
 * "temporarily unenforced", never to "platform down".
 */
@Injectable()
export class IpBlockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IpBlockService.name);

  private exactBlocks = new Map<string, string>(); // key -> blockId
  private rangeBlocks: CachedRange[] = [];
  private whitelistExact = new Set<string>();
  private whitelistRanges: ParsedCidr[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  static readonly REFRESH_MS = 30_000;

  constructor(
    @InjectModel(BlockedIp.name)
    private readonly blockedIpModel: Model<BlockedIpDocument>,
    @InjectModel(IpWhitelist.name)
    private readonly whitelistModel: Model<IpWhitelistDocument>,
    @InjectModel(SecurityAudit.name)
    private readonly auditModel: Model<SecurityAuditDocument>,
  ) {}

  async onModuleInit() {
    await this.refresh();
    this.refreshTimer = setInterval(
      () => void this.refresh(),
      IpBlockService.REFRESH_MS,
    );
    this.refreshTimer.unref();
  }

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async refresh(): Promise<void> {
    try {
      const now = new Date();
      const [blocks, whitelist] = await Promise.all([
        this.blockedIpModel
          .find({
            $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
          })
          .select('key')
          .lean(),
        this.whitelistModel.find().select('key').lean(),
      ]);

      const exact = new Map<string, string>();
      const ranges: CachedRange[] = [];
      for (const block of blocks) {
        const id = String(block._id);
        if (block.key.includes('/')) {
          const cidr = parseCidr(block.key);
          if (cidr) ranges.push({ cidr, blockId: id });
        } else {
          exact.set(block.key, id);
        }
      }

      const wlExact = new Set<string>();
      const wlRanges: ParsedCidr[] = [];
      for (const entry of whitelist) {
        if (entry.key.includes('/')) {
          const cidr = parseCidr(entry.key);
          if (cidr) wlRanges.push(cidr);
        } else {
          const ip = normalizeIp(entry.key);
          if (ip) wlExact.add(ip);
        }
      }

      this.exactBlocks = exact;
      this.rangeBlocks = ranges;
      this.whitelistExact = wlExact;
      this.whitelistRanges = wlRanges;
    } catch (error) {
      this.logger.error(
        `Blocklist refresh failed, serving previous cache: ${error.message}`,
      );
    }
  }

  isWhitelisted(ip: string): boolean {
    const normalized = normalizeIp(ip);
    if (!normalized) return false;
    if (this.whitelistExact.has(normalized)) return true;
    return this.whitelistRanges.some((cidr) => cidrContains(cidr, normalized));
  }

  /** Never throws. Whitelist wins over every block. */
  findBlock(ip: string): BlockMatch | null {
    const normalized = normalizeIp(ip);
    if (!normalized || this.isWhitelisted(normalized)) return null;

    const key = blockKeyForIp(normalized);
    if (key) {
      const exactId = this.exactBlocks.get(key);
      if (exactId) return { blockId: exactId, key };
    }
    // A bare IPv4 also matches when its exact form was blocked pre-/64 keying.
    const directId = this.exactBlocks.get(normalized);
    if (directId) return { blockId: directId, key: normalized };

    for (const range of this.rangeBlocks) {
      if (cidrContains(range.cidr, normalized)) {
        return { blockId: range.blockId, key: normalized };
      }
    }
    return null;
  }

  async block(params: {
    ipOrCidr: string;
    reason: string;
    type: BlockType;
    actor: string;
    actorName: string;
    expiresAt: Date | null;
  }): Promise<BlockedIpDocument> {
    const { ipOrCidr, reason, type, actor, actorName, expiresAt } = params;

    const key = ipOrCidr.includes('/')
      ? parseCidr(ipOrCidr) && ipOrCidr.trim().toLowerCase()
      : blockKeyForIp(ipOrCidr);
    if (!key) {
      throw new Error(`"${ipOrCidr}" is not a valid IP address or CIDR range`);
    }

    // Re-blocking an already-blocked key extends/overwrites rather than duplicating.
    const block = await this.blockedIpModel.findOneAndUpdate(
      { key },
      {
        key,
        sourceIp: ipOrCidr.trim(),
        type,
        reason,
        blockedBy: actor,
        expiresAt,
      },
      { new: true, upsert: true },
    );

    await this.auditModel.create({
      action:
        type === BlockType.AUTO
          ? SecurityAuditAction.AUTO_BLOCK
          : SecurityAuditAction.BLOCK,
      key,
      reason,
      actor,
      actorName,
      detail: { expiresAt, blockId: String(block._id) },
    });

    await this.refresh();
    return block;
  }

  async unblock(params: {
    key: string;
    actor: string;
    actorName: string;
    reason: string;
  }): Promise<boolean> {
    const removed = await this.blockedIpModel.findOneAndDelete({
      key: params.key,
    });
    if (!removed) return false;

    await this.auditModel.create({
      action: SecurityAuditAction.UNBLOCK,
      key: params.key,
      reason: params.reason,
      actor: params.actor,
      actorName: params.actorName,
      detail: { previousType: removed.type },
    });

    await this.refresh();
    return true;
  }

  /** Recent auto-blocks for a key, used for escalation decisions. */
  async countRecentAutoBlocks(key: string, since: Date): Promise<number> {
    return this.auditModel.countDocuments({
      action: SecurityAuditAction.AUTO_BLOCK,
      key,
      createdAt: { $gte: since },
    });
  }
}
