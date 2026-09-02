import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LiveHlsService } from './live-hls.service';

/**
 * The HLS gate: files are only reachable with a short-lived playback token
 * scoped to one class, and file names can never escape the class directory.
 */

const CLASS_ID = '6a987be9584429420c0b223c';
const TUTOR = 'tutor-1';
const STUDENT = 'student-1';

function makeService() {
  const cls = {
    _id: CLASS_ID,
    tutorId: { _id: TUTOR, toString: () => TUTOR },
    students: [{ _id: STUDENT, toString: () => STUDENT }],
  };
  const classesService: any = { findOne: jest.fn().mockResolvedValue(cls) };
  const jwtService: any = {
    signAsync: jest.fn().mockResolvedValue('signed-token'),
    verify: jest.fn(),
  };
  const config = {
    get: (key: string) =>
      key === 'ingest.hlsDir' ? '/data/live-hls' : undefined,
  } as ConfigService;
  const service = new LiveHlsService(classesService, jwtService, config);
  return { service, classesService, jwtService };
}

describe('mintPlaybackToken', () => {
  it('issues a class-scoped token to the tutor and to enrolled students', async () => {
    const { service, jwtService } = makeService();
    await service.mintPlaybackToken(CLASS_ID, TUTOR, 'tutor');
    await service.mintPlaybackToken(CLASS_ID, STUDENT, 'student');
    expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
    const payload = jwtService.signAsync.mock.calls[0][0];
    expect(payload.classId).toBe(CLASS_ID);
    expect(payload.purpose).toBe('hls');
  });

  it('admins can watch without enrollment', async () => {
    const { service } = makeService();
    await expect(
      service.mintPlaybackToken(CLASS_ID, 'someone', 'admin'),
    ).resolves.toBeTruthy();
  });

  it('refuses an outsider', async () => {
    const { service } = makeService();
    await expect(
      service.mintPlaybackToken(CLASS_ID, 'outsider', 'student'),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('assertPlayable', () => {
  it('accepts a valid token for the same class', () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockReturnValue({ purpose: 'hls', classId: CLASS_ID });
    expect(() => service.assertPlayable('t', CLASS_ID)).not.toThrow();
  });

  it('rejects a token for a different class', () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockReturnValue({ purpose: 'hls', classId: 'other' });
    expect(() => service.assertPlayable('t', CLASS_ID)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a general access token used as a playback token', () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockReturnValue({ sub: 'user', classId: CLASS_ID });
    expect(() => service.assertPlayable('t', CLASS_ID)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects garbage tokens', () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad signature');
    });
    expect(() => service.assertPlayable('t', CLASS_ID)).toThrow(
      UnauthorizedException,
    );
  });
});

describe('filePathFor', () => {
  it('serves playlist and segments from the class directory', () => {
    const { service } = makeService();
    expect(service.filePathFor(CLASS_ID, 'index.m3u8')).toBe(
      `/data/live-hls/${CLASS_ID}/index.m3u8`,
    );
    expect(service.filePathFor(CLASS_ID, 'seg_00042.ts')).toBe(
      `/data/live-hls/${CLASS_ID}/seg_00042.ts`,
    );
  });

  it('never lets a file name escape the class directory', () => {
    const { service } = makeService();
    for (const evil of ['../secrets.env', 'a/b.ts', '..%2Fx', 'seg;rm.ts', '.hidden']) {
      expect(() => service.filePathFor(CLASS_ID, evil)).toThrow(
        BadRequestException,
      );
    }
  });

  it('rejects malformed class ids', () => {
    const { service } = makeService();
    expect(() => service.filePathFor('../oops', 'index.m3u8')).toThrow(
      BadRequestException,
    );
  });
});
