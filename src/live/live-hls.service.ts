import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as path from 'path';
import { ClassesService } from '../classes/services/classes.service';

const CLASS_ID_RE = /^[a-f0-9]{24}$/i;
// Exactly the files the relay's ffmpeg writes — nothing else is servable.
const FILE_RE = /^(index\.m3u8|seg_\d+\.ts)$/;

/**
 * How long a "yes, this viewer may watch" answer is reused. Bounds both the
 * database load (one read per viewer per window, not one per segment) and how
 * long a removed viewer can still pull segments.
 */
const ACCESS_CACHE_MS = 10_000;

const idOf = (value: any): string =>
  value && typeof value === 'object'
    ? String(value._id ?? value.id ?? '')
    : String(value ?? '');

/**
 * The gate in front of self-hosted live streams.
 *
 * Playback works with a short-lived token scoped to ONE class, minted only
 * for the tutor, enrolled students, or admins. The token rides in the URL
 * path (so HLS players resolve segment URLs under it with zero
 * configuration), and file names are allow-listed so a request can never
 * escape the class's directory.
 */
@Injectable()
export class LiveHlsService {
  /** `${classId}:${userId}` -> epoch ms after which access must be re-read. */
  private readonly accessCache = new Map<string, number>();

  constructor(
    private readonly classesService: ClassesService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get hlsDir(): string {
    return (
      this.config.get<string>('ingest.hlsDir') ||
      path.join(process.cwd(), 'live-hls')
    );
  }

  /** May this user watch the class right now? */
  private async mayWatch(
    classId: string,
    userId: string,
    role: string,
  ): Promise<boolean> {
    if (role === 'admin') return true;
    const cls = await this.classesService.findOne(classId);
    if (idOf(cls.tutorId) === userId) return true;
    return (cls.students ?? []).some((s: any) => idOf(s) === userId);
  }

  async mintPlaybackToken(
    classId: string,
    userId: string,
    role: string,
  ): Promise<string> {
    if (!(await this.mayWatch(classId, userId, role))) {
      throw new ForbiddenException('You are not enrolled in this class');
    }
    // `role` rides in the token so playback can re-authorise without another
    // user lookup on every segment.
    return this.jwtService.signAsync(
      { purpose: 'hls', classId, sub: userId, role },
      { expiresIn: '6h' },
    );
  }

  /**
   * Throws unless the token is a playback token for this class AND its holder
   * is still allowed to watch.
   *
   * The second half matters: a token is valid for hours, so checking enrolment
   * only when it was minted would let a student who left (or was removed) keep
   * watching until it expired. Access is re-read here, cached briefly so that
   * a segment request every ~2s per viewer does not become a database read
   * every ~2s per viewer — a departed viewer loses the stream within
   * `ACCESS_CACHE_MS` rather than within hours.
   */
  async assertPlayable(token: string, classId: string): Promise<void> {
    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid playback token');
    }
    if (payload?.purpose !== 'hls' || payload?.classId !== classId) {
      throw new UnauthorizedException('Invalid playback token');
    }

    const userId = String(payload.sub ?? '');
    const key = `${classId}:${userId}`;
    const cached = this.accessCache.get(key);
    if (cached !== undefined && cached > Date.now()) return;

    if (!(await this.mayWatch(classId, userId, String(payload.role ?? '')))) {
      this.accessCache.delete(key);
      throw new UnauthorizedException('You are no longer in this class');
    }
    this.accessCache.set(key, Date.now() + ACCESS_CACHE_MS);
  }

  /** Resolve a served file inside the class directory — and only inside it. */
  filePathFor(classId: string, file: string): string {
    if (!CLASS_ID_RE.test(classId)) {
      throw new BadRequestException('Invalid class id');
    }
    if (!FILE_RE.test(file)) {
      throw new BadRequestException('Invalid stream file');
    }
    return path.join(this.hlsDir, classId, file);
  }
}
