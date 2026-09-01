/**
 * ffmpeg invocation for the browser→RTMP relay, kept pure so the command
 * line is testable without spawning anything.
 */

/** Does the recorder mime carry H.264 video (copyable straight to RTMP)? */
export const isH264Mime = (mime?: string): boolean => {
  const m = (mime ?? '').toLowerCase();
  return m.includes('h264') || m.includes('avc1');
};

/** Join ingest URL + stream key with exactly one slash. */
export const rtmpTarget = (rtmpUrl: string, streamKey: string): string =>
  `${rtmpUrl.replace(/\/+$/, '')}/${streamKey}`;

/**
 * Build the argument list. Input is a live webm stream on stdin (1s
 * MediaRecorder chunks). H.264 video is copied — near-zero CPU; VP8/VP9 is
 * transcoded with a realtime x264 profile (~1 core per class). Audio is
 * always re-encoded: browsers record Opus, and FLV/RTMP cannot carry it.
 */
export const buildFfmpegArgs = ({
  h264,
  target,
}: {
  h264: boolean;
  target: string;
}): string[] => [
  '-hide_banner',
  '-loglevel', 'warning',
  '-i', 'pipe:0',
  ...(h264
    ? ['-c:v', 'copy']
    : [
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-b:v', '2500k',
        '-maxrate', '2500k',
        '-bufsize', '5000k',
        '-pix_fmt', 'yuv420p',
        '-g', '60',
      ]),
  '-c:a', 'aac',
  '-b:a', '128k',
  '-ar', '44100',
  '-f', 'flv',
  target,
];
