// A fake player behind the port of the video session (EVM-143): records every call; `emit` delivers an event the way a native player does, also after the release.
import type { PlayerEvent, VideoPlayerPort } from '../../src/media-view/video-session';

export class FakePort implements VideoPlayerPort {
  readonly loads: { url: string; startAt: number }[] = [];
  readonly calls: string[] = [];
  released = false;
  at = 0;
  readonly #listeners = new Set<(event: PlayerEvent) => void>();
  load(url: string, startAt: number): void {
    if (this.released) return;
    this.loads.push({ url, startAt });
  }
  play(): void {
    this.calls.push('play');
  }
  pause(): void {
    this.calls.push('pause');
  }
  position(): number {
    return this.at;
  }
  subscribe(listener: (event: PlayerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  release(): void {
    this.released = true;
    this.calls.push('release');
  }
  /** Delivers an event the way a native player does - also to a released one (the session must ignore it). */
  emit(event: PlayerEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}
