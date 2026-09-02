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

  async mintPlaybackToken(
    classId: string,
    userId: string,
    role: string,
  ): Promise<string> {
    const cls = await this.classesService.findOne(classId);
    const isTutor = idOf(cls.tutorId) === userId;
    const isEnrolled = (cls.students ?? []).some(
      (s: any) => idOf(s) === userId,
    );
    if (role !== 'admin' && !isTutor && !isEnrolled) {
      throw new ForbiddenException('You are not enrolled in this class');
    }
    return this.jwtService.signAsync(
      { purpose: 'hls', classId, sub: userId },
      { expiresIn: '6h' },
    );
  }

  /** Throws unless the token is a playback token for exactly this class. */
  assertPlayable(token: string, classId: string): void {
    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid playback token');
    }
    if (payload?.purpose !== 'hls' || payload?.classId !== classId) {
      throw new UnauthorizedException('Invalid playback token');
    }
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
