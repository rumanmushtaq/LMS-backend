import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IngestService } from './ingest.service';

/**
 * The relay's contract: one ffmpeg per live class, tutor-only end to end,
 * chunks reach stdin, and every way a broadcast dies reports back instead of
 * leaving a zombie session.
 */

const TUTOR = 'tutor-1';

class FakeProc {
  args: string[];
  cmd: string;
  written: Buffer[] = [];
  ended = false;
  killed = false;
  private handlers: Record<string, ((...a: any[]) => void)[]> = {};
  stdin = {
    write: (c: Buffer) => {
      this.written.push(c);
      return true;
    },
    end: () => {
      this.ended = true;
    },
  };
  stderr = {
    on: (event: string, cb: (d: Buffer) => void) => {
      if (event === 'data') this.stderrCb = cb;
    },
  };
  stderrCb: ((d: Buffer) => void) | null = null;
  constructor(cmd: string, args: string[]) {
    this.cmd = cmd;
    this.args = args;
  }
  kill() {
    this.killed = true;
  }
  on(event: string, cb: (...a: any[]) => void) {
    (this.handlers[event] ??= []).push(cb);
  }
  emit(event: string, ...a: any[]) {
    for (const cb of this.handlers[event] ?? []) cb(...a);
  }
}

function makeService(over: { liveSession?: any; ffmpegPath?: string } = {}) {
  const cls = {
    _id: 'class-1',
    tutorId: { _id: TUTOR, toString: () => TUTOR },
    liveSession: over.liveSession ?? {
      rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'key-1',
    },
  };
  const classesService: any = { findOne: jest.fn().mockResolvedValue(cls) };
  const config = {
    get: (key: string) =>
      key === 'ingest.ffmpegPath' ? over.ffmpegPath ?? 'ffmpeg' : undefined,
  } as ConfigService;

  const service = new IngestService(classesService, config);
  const procs: FakeProc[] = [];
  service.spawnFn = (cmd: string, args: string[]) => {
    const p = new FakeProc(cmd, args);
    procs.push(p);
    return p as any;
  };
  const events: Array<{ event: string; detail?: string }> = [];
  const onEvent = (event: string, detail?: string) =>
    events.push({ event, detail });
  return { service, classesService, procs, events, onEvent };
}

describe('start', () => {
  it('spawns ffmpeg against the provisioned RTMP target and reports ready', async () => {
    const { service, procs, events, onEvent } = makeService();
    await service.start('class-1', TUTOR, 'video/webm;codecs=h264,opus', onEvent);

    expect(procs).toHaveLength(1);
    expect(procs[0].args[procs[0].args.length - 1]).toBe(
      'rtmp://a.rtmp.youtube.com/live2/key-1',
    );
    expect(events).toEqual([{ event: 'ready', detail: undefined }]);
  });

  it('uses the configured ffmpeg binary path', async () => {
    const { service, procs, onEvent } = makeService({
      ffmpegPath: '/home/x/bin/ffmpeg',
    });
    await service.start('class-1', TUTOR, 'video/webm', onEvent);
    expect(procs[0].cmd).toBe('/home/x/bin/ffmpeg');
  });

  it('refuses a user who does not own the class', async () => {
    const { service, onEvent } = makeService();
    await expect(
      service.start('class-1', 'someone-else', 'video/webm', onEvent),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses when the live session has no broadcast credentials yet', async () => {
    const { service, onEvent } = makeService({ liveSession: { rtmpUrl: null } });
    await expect(
      service.start('class-1', TUTOR, 'video/webm', onEvent),
    ).rejects.toThrow(BadRequestException);
  });

  it('replaces a previous broadcast for the same class instead of stacking', async () => {
    const { service, procs, onEvent } = makeService();
    await service.start('class-1', TUTOR, 'video/webm', onEvent);
    await service.start('class-1', TUTOR, 'video/webm', onEvent);
    expect(procs).toHaveLength(2);
    expect(procs[0].killed).toBe(true);
    service.write('class-1', TUTOR, Buffer.from('x'));
    expect(procs[1].written).toHaveLength(1);
    expect(procs[0].written).toHaveLength(0);
  });
});

describe('write', () => {
  it('pipes chunks into ffmpeg stdin', async () => {
    const { service, procs, onEvent } = makeService();
    await service.start('class-1', TUTOR, 'video/webm', onEvent);
    service.write('class-1', TUTOR, Buffer.from('abc'));
    service.write('class-1', TUTOR, Buffer.from('def'));
    expect(procs[0].written.map(String)).toEqual(['abc', 'def']);
  });

  it('rejects chunks for a class with no running broadcast', () => {
    const { service } = makeService();
    expect(() => service.write('class-1', TUTOR, Buffer.from('x'))).toThrow(
      BadRequestException,
    );
  });

  it('rejects chunks from anyone but the tutor who started it', async () => {
    const { service, onEvent } = makeService();
    await service.start('class-1', TUTOR, 'video/webm', onEvent);
    expect(() =>
      service.write('class-1', 'intruder', Buffer.from('x')),
    ).toThrow(ForbiddenException);
  });
});

describe('lifecycle', () => {
  it('reports an error with the stderr tail when ffmpeg dies', async () => {
    const { service, procs, events, onEvent } = makeService();
    await service.start('class-1', TUTOR, 'video/webm', onEvent);
    procs[0].stderrCb?.(Buffer.from('Connection refused'));
    procs[0].emit('exit', 1);

    const err = events.find((e) => e.event === 'error');
    expect(err?.detail).toContain('Connection refused');
    // Session is gone: further chunks are refused rather than silently dropped.
    expect(() => service.write('class-1', TUTOR, Buffer.from('x'))).toThrow(
      BadRequestException,
    );
  });

  it('reports a clear error when the ffmpeg binary is missing', async () => {
    const { service, procs, events, onEvent } = makeService();
    await service.start('class-1', TUTOR, 'video/webm', onEvent);
    procs[0].emit('error', Object.assign(new Error('spawn ffmpeg ENOENT')));

    const err = events.find((e) => e.event === 'error');
    expect(err?.detail?.toLowerCase()).toContain('ffmpeg');
  });

  it('stop() ends stdin gracefully and clears the session on exit', async () => {
    const { service, procs, events, onEvent } = makeService();
    await service.start('class-1', TUTOR, 'video/webm', onEvent);
    service.stop('class-1', TUTOR);
    expect(procs[0].ended).toBe(true);

    procs[0].emit('exit', 0);
    expect(events.some((e) => e.event === 'ended')).toBe(true);
    expect(() => service.write('class-1', TUTOR, Buffer.from('x'))).toThrow(
      BadRequestException,
    );
  });

  it('stop() by a non-owner is refused', async () => {
    const { service, onEvent } = makeService();
    await service.start('class-1', TUTOR, 'video/webm', onEvent);
    expect(() => service.stop('class-1', 'intruder')).toThrow(
      ForbiddenException,
    );
  });
});
