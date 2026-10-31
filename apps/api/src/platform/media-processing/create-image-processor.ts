/**
 * Builds the image processor from the validated configuration (EVM-068): `null` without `MEDIA_PROCESSOR_SOCKET` and `MEDIA_PROCESSOR_WORKDIR` -
 * the worker then makes no derivatives and the photos stay `clean` (fail closed; production refuses to start the worker without it).
 */
import type { MediaConfig } from '../config/media-config.ts';
import type { ImageProcessor } from './image-processor.ts';
import { UnixSocketImageProcessor } from './unix-socket-image-processor.ts';

export function createImageProcessor(media: MediaConfig | undefined): ImageProcessor | null {
  return media?.processor === undefined ? null : new UnixSocketImageProcessor(media.processor);
}
