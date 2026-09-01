import { buildFfmpegArgs, isH264Mime, rtmpTarget } from './ffmpeg-args';

describe('isH264Mime', () => {
  it('recognises H.264 recorder mime types, case-insensitively', () => {
    expect(isH264Mime('video/webm;codecs=h264,opus')).toBe(true);
    expect(isH264Mime('video/webm;codecs=H264')).toBe(true);
    expect(isH264Mime('video/mp4;codecs=avc1.42E01E,mp4a.40.2')).toBe(true);
  });

  it('treats VP8/VP9 and unknown mimes as needing a transcode', () => {
    expect(isH264Mime('video/webm;codecs=vp9,opus')).toBe(false);
    expect(isH264Mime('video/webm')).toBe(false);
    expect(isH264Mime(undefined)).toBe(false);
  });
});

describe('rtmpTarget', () => {
  it('joins ingest URL and stream key with exactly one slash', () => {
    expect(rtmpTarget('rtmp://a.rtmp.youtube.com/live2', 'key-1')).toBe(
      'rtmp://a.rtmp.youtube.com/live2/key-1',
    );
    expect(rtmpTarget('rtmp://a.rtmp.youtube.com/live2/', 'key-1')).toBe(
      'rtmp://a.rtmp.youtube.com/live2/key-1',
    );
  });
});

describe('buildFfmpegArgs', () => {
  const target = 'rtmp://a.rtmp.youtube.com/live2/key-1';

  it('copies the video track when the browser already encodes H.264', () => {
    const args = buildFfmpegArgs({ h264: true, target });
    const cv = args.indexOf('-c:v');
    expect(args[cv + 1]).toBe('copy');
    expect(args).not.toContain('libx264');
  });

  it('transcodes VP8/VP9 with a realtime x264 profile', () => {
    const args = buildFfmpegArgs({ h264: false, target });
    const cv = args.indexOf('-c:v');
    expect(args[cv + 1]).toBe('libx264');
    expect(args).toContain('zerolatency');
  });

  it('always converts audio to AAC (RTMP cannot carry Opus)', () => {
    const args = buildFfmpegArgs({ h264: true, target });
    const ca = args.indexOf('-c:a');
    expect(args[ca + 1]).toBe('aac');
  });

  it('reads from stdin and ends with an FLV push to the target', () => {
    const args = buildFfmpegArgs({ h264: true, target });
    expect(args).toContain('pipe:0');
    expect(args.slice(-3)).toEqual(['-f', 'flv', target]);
  });
});
