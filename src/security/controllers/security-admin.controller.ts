import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Model } from 'mongoose';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { blockKeyForIp, parseCidr, resolveClientIp } from '../../common/utils';
import {
  User,
  UserDocument,
  UserRole,
} from '../../users/schemas/user.schema';
import {
  AddWhitelistDto,
  AuditQueryDto,
  BLOCK_DURATION_MS,
  BlockDuration,
  BlockIpDto,
  ListIpsQueryDto,
  UnblockIpDto,
} from '../dto';
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
import { IpActivityService } from '../services/ip-activity.service';
import { IpBlockService } from '../services/ip-block.service';

function adminDisplayName(admin: UserDocument): string {
  const name = `${admin.firstName ?? ''} ${admin.lastName ?? ''}`.trim();
  return name || admin.email;
}

@ApiTags('Security')
@ApiBearerAuth()
@Controller('admin/security')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SecurityAdminController {
  constructor(
    private readonly configService: ConfigService,
    private readonly ipBlockService: IpBlockService,
    private readonly ipActivityService: IpActivityService,
    @InjectModel(BlockedIp.name)
    private readonly blockedIpModel: Model<BlockedIpDocument>,
    @InjectModel(IpWhitelist.name)
    private readonly whitelistModel: Model<IpWhitelistDocument>,
    @InjectModel(SecurityAudit.name)
    private readonly auditModel: Model<SecurityAuditDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /** The admin UI uses this to badge "this is your IP" and warn before self-blocks. */
  @Get('whoami')
  @ApiOperation({ summary: "Caller's IP as the API resolves it" })
  whoami(@Req() req: Request) {
    const ip =
      (req as Request & { clientIp?: string }).clientIp ??
      resolveClientIp(
        { headers: req.headers, remoteAddress: req.ip },
        {
          trustCloudflare: this.configService.get<boolean>(
            'security.trustCloudflare',
            false,
          ),
        },
      );
    return { ip: ip ?? null, blockKey: ip ? blockKeyForIp(ip) : null };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Headline numbers for the dashboard cards' })
  async stats(@Query('hours') hours = '24') {
    const windowHours = Math.min(parseInt(hours, 10) || 24, 24 * 30);
    const [activity, activeBlocks, autoBlocks24h] = await Promise.all([
      this.ipActivityService.stats(windowHours),
      this.blockedIpModel.countDocuments({
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      }),
      this.auditModel.countDocuments({
        action: SecurityAuditAction.AUTO_BLOCK,
        createdAt: { $gte: new Date(Date.now() - windowHours * 3600_000) },
      }),
    ]);
    return {
      ...activity,
      activeBlocks,
      autoBlocks: autoBlocks24h,
      enforced: this.configService.get<boolean>('security.enforceIpBlocks', false),
    };
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Hourly request/blocked series for the chart' })
  timeseries(@Query('hours') hours = '168') {
    const windowHours = Math.min(parseInt(hours, 10) || 168, 24 * 30);
    return this.ipActivityService.timeseries(windowHours);
  }

  @Get('ips')
  @ApiOperation({ summary: 'Paginated IP list with per-IP stats and block status' })
  async listIps(@Query() query: ListIpsQueryDto) {
    const result = await this.ipActivityService.listIps({
      page: query.page,
      limit: query.limit,
      search: query.search,
      windowHours: query.hours,
      sort: query.sort,
    });

    const items = result.items.map((item: any) => {
      const block = this.ipBlockService.findBlock(item.ip);
      return {
        ...item,
        status: block ? 'blocked' : 'active',
        blockId: block?.blockId ?? null,
        whitelisted: this.ipBlockService.isWhitelisted(item.ip),
        risk: this.riskFor(item),
      };
    });
    return { ...result, items };
  }

  @Get('ips/:ip')
  @ApiOperation({ summary: 'Activity timeline and associated accounts for one IP' })
  async ipDetail(@Param('ip') ip: string, @Query('hours') hours = '168') {
    const windowHours = Math.min(parseInt(hours, 10) || 168, 24 * 30);
    const detail = await this.ipActivityService.ipDetail(ip, windowHours);

    const users = detail.userIds.length
      ? await this.userModel
          .find({ _id: { $in: detail.userIds } })
          .select('firstName lastName email role status')
          .lean()
      : [];

    const key = blockKeyForIp(detail.ip);
    const blockHistory = key
      ? await this.auditModel
          .find({ key: { $in: [key, detail.ip] } })
          .sort({ createdAt: -1 })
          .limit(50)
          .lean()
      : [];

    const block = this.ipBlockService.findBlock(detail.ip);
    return {
      ...detail,
      users,
      blockHistory,
      status: block ? 'blocked' : 'active',
      blockId: block?.blockId ?? null,
      whitelisted: this.ipBlockService.isWhitelisted(detail.ip),
    };
  }

  @Get('blocks')
  @ApiOperation({ summary: 'All active blocks' })
  async listBlocks() {
    return this.blockedIpModel
      .find({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] })
      .sort({ createdAt: -1 })
      .lean();
  }

  @Post('blocks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Block an IP or CIDR range' })
  async block(@CurrentUser() admin: UserDocument, @Body() dto: BlockIpDto) {
    const target = dto.ip.trim();
    const valid = target.includes('/')
      ? parseCidr(target) !== null
      : blockKeyForIp(target) !== undefined;
    if (!valid) {
      throw new BadRequestException(
        `"${dto.ip}" is not a valid IP address or CIDR range`,
      );
    }
    if (this.ipBlockService.isWhitelisted(target.split('/')[0])) {
      throw new BadRequestException(
        'This address is whitelisted. Remove it from the whitelist first.',
      );
    }

    const durationMs = BLOCK_DURATION_MS[dto.duration];
    const block = await this.ipBlockService.block({
      ipOrCidr: target,
      reason: dto.reason,
      type: BlockType.MANUAL,
      actor: String(admin._id),
      actorName: adminDisplayName(admin),
      expiresAt:
        dto.duration === BlockDuration.PERMANENT
          ? null
          : new Date(Date.now() + (durationMs as number)),
    });
    return block;
  }

  @Delete('blocks/:key')
  @ApiOperation({ summary: 'Unblock (key is the blocked key, URL-encoded)' })
  async unblock(
    @CurrentUser() admin: UserDocument,
    @Param('key') key: string,
    @Body() dto: UnblockIpDto,
  ) {
    const removed = await this.ipBlockService.unblock({
      key: decodeURIComponent(key),
      actor: String(admin._id),
      actorName: adminDisplayName(admin),
      reason: dto.reason ?? 'Unblocked by admin',
    });
    if (!removed) throw new NotFoundException('No active block for that key');
    return { message: 'Unblocked' };
  }

  @Get('whitelist')
  @ApiOperation({ summary: 'Whitelisted addresses' })
  listWhitelist() {
    return this.whitelistModel.find().sort({ createdAt: -1 }).lean();
  }

  @Post('whitelist')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an IP/CIDR to the whitelist' })
  async addWhitelist(
    @CurrentUser() admin: UserDocument,
    @Body() dto: AddWhitelistDto,
  ) {
    const target = dto.ip.trim().toLowerCase();
    const valid = target.includes('/')
      ? parseCidr(target) !== null
      : blockKeyForIp(target) !== undefined;
    if (!valid) {
      throw new BadRequestException(
        `"${dto.ip}" is not a valid IP address or CIDR range`,
      );
    }

    const entry = await this.whitelistModel.findOneAndUpdate(
      { key: target },
      { key: target, label: dto.label, addedBy: String(admin._id) },
      { new: true, upsert: true },
    );
    await this.auditModel.create({
      action: SecurityAuditAction.WHITELIST_ADD,
      key: target,
      reason: dto.label,
      actor: String(admin._id),
      actorName: adminDisplayName(admin),
      detail: null,
    });
    await this.ipBlockService.refresh();
    return entry;
  }

  @Delete('whitelist/:key')
  @ApiOperation({ summary: 'Remove a whitelist entry' })
  async removeWhitelist(
    @CurrentUser() admin: UserDocument,
    @Param('key') key: string,
  ) {
    const decoded = decodeURIComponent(key).toLowerCase();
    const removed = await this.whitelistModel.findOneAndDelete({ key: decoded });
    if (!removed) throw new NotFoundException('Not on the whitelist');

    await this.auditModel.create({
      action: SecurityAuditAction.WHITELIST_REMOVE,
      key: decoded,
      reason: removed.label,
      actor: String(admin._id),
      actorName: adminDisplayName(admin),
      detail: null,
    });
    await this.ipBlockService.refresh();
    return { message: 'Removed' };
  }

  @Get('audit')
  @ApiOperation({ summary: 'Append-only audit trail (search by key or incident id)' })
  async audit(@Query() query: AuditQueryDto) {
    const filter: Record<string, unknown> = {};
    if (query.search) {
      const s = query.search.trim();
      filter.$or = [
        { key: { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } },
        { 'detail.blockId': s },
      ];
    }
    const [items, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      this.auditModel.countDocuments(filter),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  /**
   * Risk is a heuristic for triage ordering, not a verdict — the UI must
   * always show *why* next to the badge.
   */
  private riskFor(item: {
    failedLogins: number;
    accounts: number;
    requests: number;
  }): { level: 'low' | 'medium' | 'high'; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;

    if (item.failedLogins >= 20) {
      score += 2;
      reasons.push(`${item.failedLogins} failed logins`);
    } else if (item.failedLogins >= 5) {
      score += 1;
      reasons.push(`${item.failedLogins} failed logins`);
    }
    if (item.accounts >= 10) {
      score += 2;
      reasons.push(`${item.accounts} accounts from one IP`);
    } else if (item.accounts >= 4) {
      score += 1;
      reasons.push(`${item.accounts} accounts from one IP`);
    }
    if (item.requests >= 10_000) {
      score += 1;
      reasons.push(`${item.requests} requests in window`);
    }

    const level = score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';
    return { level, reasons };
  }
}
