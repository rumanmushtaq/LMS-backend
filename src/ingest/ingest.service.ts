import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { ClassesService } from '../classes/services/classes.service';
import { buildFfmpegArgs, isH264Mime, rtmpTarget } from './ffmpeg-args';

/** The slice of a child process the relay actually uses — swappable in tests. */
export interface IngestProcess {
  stdin: { write(chunk: Buffer): boolean; end(): void };
  stderr?: { on(event: 'data', cb: (d: Buffer) => void): void } | null;
  kill(signal?: NodeJS.Signals): void;
  on(event: 'exit' | 'error', cb: (...args: any[]) => void): void;
}

export type SpawnFn = (cmd: string, args: string[]) => IngestProcess;

export type IngestEvent = 'ready' | 'ended' | 'error';
export type IngestEventHandler = (event: IngestEvent, detail?: string) => void;

interface Session {
  proc: IngestProcess;
  tutorId: string;
  onEvent: IngestEventHandler;
  stderrTail: string;
  stopping: boolean;
  killTimer: NodeJS.Timeout | null;
}

const KILL_GRACE_MS = 3000;

/**
 * Browser→RTMP relay: one ffmpeg process per live class. The tutor's browser
 * records webm chunks and this service pipes them into ffmpeg, which pushes
 * RTMP to whatever the class's live session was provisioned with (YouTube or
 * Vimeo — the relay doesn't care).
 *
 * Ownership is re-checked on every operation: the classId travels with each
 * chunk, so a socket must not be able to feed someone else's broadcast.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger('IngestService');
  private readonly sessions = new Map<string, Session>();

  /** Swapped for a fake in unit tests. */
  spawnFn: SpawnFn = (cmd, args) =>
    spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] }) as IngestProcess;

  constructor(
    private readonly classesService: ClassesService,
    private readonly config: ConfigService,
  ) {}

  private get ffmpegPath(): string {
    return this.config.get<string>('ingest.ffmpegPath') || 'ffmpeg';
  }

  async start(
    classId: string,
    userId: string,
    mimeType: string | undefined,
    onEvent: IngestEventHandler,
  ): Promise<void> {
    const cls = await this.classesService.findOne(classId);
    const tutorId = (cls.tutorId as any)?._id?.toString?.() ?? String(cls.tutorId);
    if (tutorId !== userId) {
      throw new ForbiddenException('Only the class tutor can broadcast');
    }

    const live = cls.liveSession;
    if (!live?.rtmpUrl || !live?.streamKey) {
      throw new BadRequestException(
        'Set up the live session before broadcasting',
      );
    }

    // A tutor who refreshed the page starts over; the stale process must die
    // first or two ffmpegs would fight over the same stream key.
    this.forceStop(classId);

    const args = buildFfmpegArgs({
      h264: isH264Mime(mimeType),
      target: rtmpTarget(live.rtmpUrl, live.streamKey),
    });

    const proc = this.spawnFn(this.ffmpegPath, args);
    const session: Session = {
      proc,
      tutorId,
      onEvent,
      stderrTail: '',
      stopping: false,
      killTimer: null,
    };
    this.sessions.set(classId, session);

    proc.stderr?.on('data', (d: Buffer) => {
      // Keep only the tail — enough to explain a failure, never unbounded.
      session.stderrTail = (session.stderrTail + d.toString()).slice(-800);
    });

    proc.on('error', (err: any) => {
      this.cleanup(classId, session);
      const detail =
        err?.code === 'ENOENT'
          ? `ffmpeg was not found (looked for "${this.ffmpegPath}"). Install ffmpeg on the server or set FFMPEG_PATH.`
          : `ffmpeg failed to start: ${err?.message}`;
      this.logger.error(detail);
      onEvent('error', detail);
    });

    proc.on('exit', (code: number | null) => {
      const wasStopping = session.stopping;
      this.cleanup(classId, session);
      if (wasStopping || code === 0) {
        onEvent('ended');
      } else {
        const detail = `ffmpeg exited with code ${code}: ${session.stderrTail || 'no output'}`;
        this.logger.warn(`[class ${classId}] ${detail}`);
        onEvent('error', detail);
      }
    });

    this.logger.log(`Broadcast relay started for class ${classId}`);
    onEvent('ready');
  }

  write(classId: string, userId: string, chunk: Buffer): void {
    const session = this.sessions.get(classId);
    if (!session) {
      throw new BadRequestException('No running broadcast for this class');
    }
    if (session.tutorId !== userId) {
      throw new ForbiddenException('Only the class tutor can broadcast');
    }
    session.proc.stdin.write(chunk);
  }

  stop(classId: string, userId: string): void {
    const session = this.sessions.get(classId);
    if (!session) return;
    if (session.tutorId !== userId) {
      throw new ForbiddenException('Only the class tutor can broadcast');
    }
    session.stopping = true;
    // Let ffmpeg flush what it has; kill only if it lingers.
    try {
      session.proc.stdin.end();
    } catch {
      /* stdin may already be gone */
    }
    session.killTimer = setTimeout(() => session.proc.kill('SIGKILL'), KILL_GRACE_MS);
  }

  /** Kill without ceremony (page refresh, replaced session, disconnect). */
  private forceStop(classId: string): void {
    const session = this.sessions.get(classId);
    if (!session) return;
    this.cleanup(classId, session);
    try {
      session.proc.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }

  private cleanup(classId: string, session: Session): void {
    if (session.killTimer) clearTimeout(session.killTimer);
    // Only remove the session if it is still the one we own — a replacement
    // may already have taken the slot.
    if (this.sessions.get(classId) === session) {
      this.sessions.delete(classId);
    }
  }
}
