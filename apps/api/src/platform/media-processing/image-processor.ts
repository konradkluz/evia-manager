/**
 * The port of the image processor (EVM-068; ADR-0009; SR-FILE-04, SR-FILE-06): the modules know this interface, never the socket, the work
 * directory or the container behind it. The processor parses hostile files, so what comes back is NOT trusted: the adapter checks every
 * byte it hands on (the type, the size, the dimensions), and an error leaves the port as {@link ImageProcessingError} with a FIXED code — the
 * text of a library or a path never travels further (SR-ERR-01).
 */
import type { Readable } from 'node:stream';

export const IMAGE_PROCESSOR = Symbol('IMAGE_PROCESSOR');

/** The variants of a photo and the longest edge of each (px): the SAME numbers as the contract (`MediaDerivativeVariant`) and the processor. */
export const VARIANT_EDGES = { thumbnail: 320, preview: 1600 } as const;
export type DerivativeVariant = keyof typeof VARIANT_EDGES;
export const DERIVATIVE_VARIANTS = Object.keys(VARIANT_EDGES) as DerivativeVariant[];

/** The longest a derivative may be (bytes): a WebP of 1600 px is a few hundred KB; more means the processor is not doing its job. */
export const MAX_DERIVATIVE_BYTES = 2 * 1024 * 1024;

/**
 * `pixel_limit`, `unsupported`, `invalid_output` — the file will never convert (permanent); `timeout`, `internal` — the processor failed on this
 * try; `unavailable` — the processor did not answer (transport, after the job was handed over); `unreachable` — the processor could not be reached at all (the job was never delivered; no fault of the file). See `domain/derivatives.ts` for what each code means for the file.
 */
export type ImageProcessingErrorCode =
  'pixel_limit' | 'unsupported' | 'invalid_output' | 'timeout' | 'internal' | 'unavailable' | 'unreachable';

export class ImageProcessingError extends Error {
  readonly code: ImageProcessingErrorCode;

  constructor(code: ImageProcessingErrorCode) {
    super(code);
    this.name = 'ImageProcessingError';
    this.code = code;
  }
}

export interface DerivedImage {
  readonly variant: DerivativeVariant;
  readonly body: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface DeriveInput {
  /** A UUID chosen by the server for THIS try: names the directory of the job; never taken from the data. */
  readonly jobId: string;
  /** The type recorded after the scan (`image/jpeg`, `image/png`, `image/webp`, `image/heic`): the processor checks the file against it. */
  readonly contentType: string;
  readonly original: Readable;
  /** The most bytes the original may have (its recorded size); a longer stream is refused. */
  readonly maxBytes: number;
  /**
   * Called when the original is whole in the work area and BEFORE the processor is asked to open it: the caller verifies the checksum of the
   * bytes there (an object that is not the one that was scanned never reaches libvips). Throwing aborts the job; the work area is cleaned either way.
   */
  readonly beforeProcessing: () => void;
}

export interface ImageProcessor {
  /** @throws ImageProcessingError a fixed code; anything `beforeProcessing` throws is rethrown as it is */
  derive(input: DeriveInput): Promise<readonly DerivedImage[]>;
  /** Removes whatever an earlier process left in the work area (the start of the worker: a crash leaves photos behind — P3). */
  cleanup(): Promise<void>;
}
