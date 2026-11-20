// A fake of the viewer of the photos seen by the screens (EVM-142): the test decides what a request answers; the images are strings in a map, like in the real viewer.
import type { ImageRequest, ImageResult, ImageVariant, MediaViewControl } from '../../src/media-view/types';

export interface PendingLoad {
  readonly request: ImageRequest;
  /** Answers the request like the viewer would: `ok` stores the image under the key first. */
  readonly settle: (result: ImageResult) => void;
}

const keyOf = (variant: ImageVariant, id: string): string => `${variant}:${id}`;

export class FakeMediaView implements MediaViewControl {
  /** Every request the screens made, in order. */
  readonly requests: ImageRequest[] = [];
  /** The requests that wait for the test to answer them (`autoAnswer` = `null`). */
  readonly pending: PendingLoad[] = [];
  readonly released: string[] = [];
  /** What an unanswered-by-hand request gets at once; `null` = the test answers through `pending`. */
  autoAnswer: ImageResult | null = { kind: 'ok' };
  #images = new Map<string, string>();
  #epoch = 0;
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getEpoch = (): number => this.#epoch;
  peek(variant: ImageVariant, id: string): string | undefined {
    return this.#images.get(keyOf(variant, id));
  }
  release(variant: ImageVariant, id: string): void {
    this.released.push(keyOf(variant, id));
    this.#images.delete(keyOf(variant, id));
  }
  /** Puts an image into the memory without a request (a thumbnail the grid already loaded). */
  put(variant: ImageVariant, id: string, uri = 'data:image/webp;base64,AAAA'): void {
    this.#images.set(keyOf(variant, id), uri);
  }
  /** What `releaseAll` of the real viewer does: forgets the images and tells the screens. */
  releaseAll(): void {
    this.#images = new Map();
    this.#epoch += 1;
    for (const listener of [...this.#listeners]) listener();
  }
  load(request: ImageRequest): Promise<ImageResult> {
    this.requests.push(request);
    const settle = (result: ImageResult): void => {
      if (result.kind === 'ok') this.put(request.variant, request.mediaAssetId);
    };
    if (this.autoAnswer !== null) {
      const result = this.autoAnswer;
      settle(result);
      return Promise.resolve(result);
    }
    return new Promise<ImageResult>((resolve) => {
      this.pending.push({
        request,
        settle: (result) => {
          settle(result);
          resolve(result);
        },
      });
    });
  }
}
