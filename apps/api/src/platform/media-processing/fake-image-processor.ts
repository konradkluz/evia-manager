/**
 * An image processor for the tests of the units (EVM-068): it reads the whole original (so the caller's checks of the stream run), calls
 * `beforeProcessing` like the real adapter and then answers with synthetic WebP containers of the sizes the real processor would produce, or with
 * what `behaviour` says. The real processor (libvips) is exercised by the tests of `services/media-processor`; the real adapter by the test of the
 * contract with a socket server. Used only by tests and never chosen by configuration.
 */
import {
  DERIVATIVE_VARIANTS,
  ImageProcessingError,
  VARIANT_EDGES,
  type DerivedImage,
  type DeriveInput,
  type ImageProcessor,
} from './image-processor.ts';
import { syntheticWebp } from './webp.ts';

export interface RecordedJob {
  readonly jobId: string;
  readonly contentType: string;
  readonly bytes: Buffer;
}

export class FakeImageProcessor implements ImageProcessor {
  /** What happens on the next jobs: `ok`, or a fixed failure; a function decides per job (and may hang to simulate a stuck job). */
  behaviour: 'ok' | ImageProcessingError | ((job: RecordedJob) => Promise<readonly DerivedImage[]>) = 'ok';
  readonly jobs: RecordedJob[] = [];
  cleanups = 0;

  async derive(input: DeriveInput): Promise<readonly DerivedImage[]> {
    const chunks: Buffer[] = [];
    for await (const chunk of input.original) chunks.push(Buffer.from(chunk as Uint8Array));
    const job: RecordedJob = { jobId: input.jobId, contentType: input.contentType, bytes: Buffer.concat(chunks) };
    this.jobs.push(job);
    input.beforeProcessing();
    if (this.behaviour === 'ok') return FakeImageProcessor.outputs(1000, 500);
    if (this.behaviour instanceof ImageProcessingError) throw this.behaviour;
    return this.behaviour(job);
  }

  cleanup(): Promise<void> {
    this.cleanups += 1;
    return Promise.resolve();
  }

  /** Both variants of a picture of `width` x `height`, scaled to fit the edges like the real processor does. */
  static outputs(width: number, height: number): DerivedImage[] {
    return DERIVATIVE_VARIANTS.map((variant) => {
      const scale = Math.min(1, VARIANT_EDGES[variant] / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      return { variant, body: syntheticWebp(w, h), width: w, height: h };
    });
  }
}
