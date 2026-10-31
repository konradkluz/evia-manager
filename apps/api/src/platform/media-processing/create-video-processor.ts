/**
 * Builds the video processor from the validated configuration (EVM-046): `null` without the socket, the work area of photos and the work area of VIDEOS -
 * the worker then makes no derivatives of films and they stay `clean` (fail closed; the original of a film is not released before the probe either).
 */
import type { MediaConfig } from '../config/media-config.ts';
import { UnixSocketVideoProcessor } from './unix-socket-video-processor.ts';
import type { VideoProcessor } from './video-processor.ts';

export function createVideoProcessor(media: MediaConfig | undefined): VideoProcessor | null {
  const processor = media?.processor;
  if (processor?.videoWorkDir === undefined) return null;
  return new UnixSocketVideoProcessor({ socketPath: processor.socketPath, workDir: processor.videoWorkDir });
}
