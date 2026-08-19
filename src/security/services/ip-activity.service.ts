import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { normalizeIp } from '../../common/utils';
import { IpActivity, IpActivityDocument } from '../schemas/ip-activity.schema';

interface BucketDelta {
  ip: string;
  hour: Date;
  requests: number;
  failedLogins: number;
  blocked: number;
  userIds: Set<string>;
  lastSeen: Date;
}

/**
 * Per-request writes are absorbed into an in-memory map and flushed as one
 * bulkWrite every FLUSH_MS. Losing up to one flush window of counters on a
 * hard crash is an acceptable trade for not adding a Mongo write to every
 * request the platform serves.
 */
@Injectable()
export class IpActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IpActivityService.name);
  private buffer = new Map<string, BucketDelta>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  static readonly FLUSH_MS = 20_000;

  constructor(
    @InjectModel(IpActivity.name)
    private readonly activityModel: Model<IpActivityDocument>,
  ) {}

  onModuleInit() {
    this.flushTimer = setInterval(
      () => void this.flush(),
      IpActivityService.FLUSH_MS,
    );
    this.flushTimer.unref();
  }

  async onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
  }

  private bucketFor(ip: string): BucketDelta | null {
    const normalized = normalizeIp(ip);
    if (!normalized) return null;
    const now = new Date();
    const hour = new Date(now);
    hour.setUTCMinutes(0, 0, 0);
    const key = `${normalized}|${hour.getTime()}`;

    let bucket = this.buffer.get(key);
    if (!bucket) {
      bucket = {
        ip: normalized,
        hour,
        requests: 0,
        failedLogins: 0,
        blocked: 0,
        userIds: new Set(),
        lastSeen: now,
      };
      this.buffer.set(key, bucket);
    }
    bucket.lastSeen = now;
    return bucket;
  }

  recordRequest(ip: string): void {
    const bucket = this.bucketFor(ip);
    if (bucket) bucket.requests += 1;
  }

  recordBlocked(ip: string): void {
    const bucket = this.bucketFor(ip);
    if (bucket) bucket.blocked += 1;
  }

  recordFailedLogin(ip: string): void {
    const bucket = this.bucketFor(ip);
    if (bucket) bucket.failedLogins += 1;
  }

  recordUser(ip: string, userId: string): void {
    const bucket = this.bucketFor(ip);
    if (bucket) bucket.userIds.add(userId);
  }

  async flush(): Promise<void> {
    if (this.buffer.size === 0) return;
    const pending = this.buffer;
    this.buffer = new Map();

    try {
      const ops = [...pending.values()].map((delta) => ({
        updateOne: {
          filter: { ip: delta.ip, hour: delta.hour },
          update: {
            $inc: {
              requests: delta.requests,
              failedLogins: delta.failedLogins,
              blocked: delta.blocked,
            },
            $set: { lastSeen: delta.lastSeen },
            ...(delta.userIds.size > 0
              ? { $addToSet: { userIds: { $each: [...delta.userIds] } } }
              : {}),
          },
          upsert: true,
        },
      }));
      await this.activityModel.bulkWrite(ops, { ordered: false });
    } catch (error) {
      this.logger.error(`Activity flush failed: ${error.message}`);
    }
  }

  // ─── Read side (admin dashboard) ──────────────────────────────────────────

  async listIps(params: {
    page: number;
    limit: number;
    search?: string;
    windowHours: number;
    sort: 'lastSeen' | 'requests' | 'failedLogins';
  }) {
    const { page, limit, search, windowHours, sort } = params;
    const since = new Date(Date.now() - windowHours * 3600_000);

    const match: Record<string, unknown> = { hour: { $gte: since } };
    if (search) {
      match.ip = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
    }

    const sortField = {
      lastSeen: 'lastSeen',
      requests: 'requests',
      failedLogins: 'failedLogins',
    }[sort];

    const [result] = await this.activityModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$ip',
          requests: { $sum: '$requests' },
          failedLogins: { $sum: '$failedLogins' },
          blocked: { $sum: '$blocked' },
          userIds: { $push: '$userIds' },
          firstSeen: { $min: '$hour' },
          lastSeen: { $max: '$lastSeen' },
        },
      },
      {
        $project: {
          _id: 0,
          ip: '$_id',
          requests: 1,
          failedLogins: 1,
          blocked: 1,
          firstSeen: 1,
          lastSeen: 1,
          userIds: {
            $setUnion: {
              $reduce: {
                input: '$userIds',
                initialValue: [],
                in: { $concatArrays: ['$$value', '$$this'] },
              },
            },
          },
        },
      },
      { $addFields: { accounts: { $size: '$userIds' } } },
      { $sort: { [sortField]: -1 } },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    ]);

    return {
      items: result?.items ?? [],
      total: result?.total?.[0]?.count ?? 0,
      page,
      limit,
    };
  }

  async ipDetail(ip: string, windowHours: number) {
    const normalized = normalizeIp(ip);
    if (!normalized) return { ip, timeline: [], userIds: [] };
    const since = new Date(Date.now() - windowHours * 3600_000);

    const timeline = await this.activityModel
      .find({ ip: normalized, hour: { $gte: since } })
      .sort({ hour: 1 })
      .select('-_id hour requests failedLogins blocked userIds lastSeen')
      .lean();

    const userIds = [...new Set(timeline.flatMap((b) => b.userIds))];
    return { ip: normalized, timeline, userIds };
  }

  async stats(windowHours: number) {
    const since = new Date(Date.now() - windowHours * 3600_000);
    const [result] = await this.activityModel.aggregate([
      { $match: { hour: { $gte: since } } },
      {
        $group: {
          _id: null,
          uniqueIps: { $addToSet: '$ip' },
          requests: { $sum: '$requests' },
          failedLogins: { $sum: '$failedLogins' },
          blocked: { $sum: '$blocked' },
        },
      },
    ]);
    return {
      uniqueIps: result?.uniqueIps?.length ?? 0,
      requests: result?.requests ?? 0,
      failedLogins: result?.failedLogins ?? 0,
      blocked: result?.blocked ?? 0,
    };
  }

  /** Hourly totals for the dashboard chart. */
  async timeseries(windowHours: number) {
    const since = new Date(Date.now() - windowHours * 3600_000);
    return this.activityModel.aggregate([
      { $match: { hour: { $gte: since } } },
      {
        $group: {
          _id: '$hour',
          requests: { $sum: '$requests' },
          failedLogins: { $sum: '$failedLogins' },
          blocked: { $sum: '$blocked' },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          hour: '$_id',
          requests: 1,
          failedLogins: 1,
          blocked: 1,
        },
      },
    ]);
  }
}
