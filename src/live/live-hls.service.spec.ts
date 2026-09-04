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
  it('accepts a valid token for the same class', async () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockReturnValue({
      purpose: 'hls',
      classId: CLASS_ID,
      sub: STUDENT,
      role: 'student',
    });
    await expect(
      service.assertPlayable('t', CLASS_ID),
    ).resolves.toBeUndefined();
  });

  it('rejects a token for a different class', async () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockReturnValue({ purpose: 'hls', classId: 'other' });
    await expect(service.assertPlayable('t', CLASS_ID)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a general access token used as a playback token', async () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockReturnValue({ sub: 'user', classId: CLASS_ID });
    await expect(service.assertPlayable('t', CLASS_ID)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects garbage tokens', async () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad signature');
    });
    await expect(service.assertPlayable('t', CLASS_ID)).rejects.toThrow(
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

describe('assertPlayable re-checks enrolment', () => {
  /**
   * The token lives for hours, so authorising once at mint time is not enough:
   * a student who leaves (or is removed) must lose the picture, not keep it
   * until their token happens to expire.
   */
  it('rejects a token held by a student who has left the class', async () => {
    const { service, classesService, jwtService } = makeService();
    jwtService.verify.mockReturnValue({
      purpose: 'hls',
      classId: CLASS_ID,
      sub: STUDENT,
      role: 'student',
    });
    classesService.findOne.mockResolvedValue({
      _id: CLASS_ID,
      tutorId: { toString: () => TUTOR },
      students: [], // the student left
    });

    await expect(service.assertPlayable('t', CLASS_ID)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('still serves a student who is on the roster', async () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockReturnValue({
      purpose: 'hls',
      classId: CLASS_ID,
      sub: STUDENT,
      role: 'student',
    });

    await expect(
      service.assertPlayable('t', CLASS_ID),
    ).resolves.toBeUndefined();
  });
});
