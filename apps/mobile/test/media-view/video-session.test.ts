// EVM-143 AC2-AC5: the playback session of a film on a fake player - no autostart, one silent refresh from the same second, progress clears the count, 403/404/429, offline,
// the lock / background / end of the session release the player, late answers and events of a released player are ignored.
import {
  MAX_SILENT_REFRESHES,
  VideoSession,
  type PlayerEvent,
  type VideoPlayerPort,
  type VideoSnapshot,
} from '../../src/media-view/video-session';
import type { VideoUrlRequest, VideoUrlResult } from '../../src/media-view/types';

const URL1 = 'https://bucket.example.test/preview-1.mp4?sig=SYNTHETIC-1';
const URL2 = 'https://bucket.example.test/preview-2.mp4?sig=SYNTHETIC-2';

class FakePort implements VideoPlayerPort {
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

function rig() {
  const ports: FakePort[] = [];
  const requests: VideoUrlRequest[] = [];
  const answers: VideoUrlResult[] = [];
  const held: ((result: VideoUrlResult) => void)[] = [];
  const listeners = new Set<() => void>();
  let allowed = true;
  let online = true;
  const viewer = {
    isAllowed: () => allowed,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestVideoUrl: (request: VideoUrlRequest): Promise<VideoUrlResult> => {
      requests.push(request);
      const next = answers.shift();
      return next === undefined ? new Promise((resolve) => held.push(resolve)) : Promise.resolve(next);
    },
  };
  const session = new VideoSession({
    viewer,
    createPort: () => {
      const port = new FakePort();
      ports.push(port);
      return port;
    },
    isOnline: () => online,
    workOrderId: 'o1',
    mediaAssetId: 'm1',
  });
  const phases: string[] = [];
  session.subscribe(() => phases.push(session.getSnapshot().phase));
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return {
    session,
    ports,
    requests,
    answers,
    held,
    phases,
    flush,
    phase: (): VideoSnapshot['phase'] => session.getSnapshot().phase,
    setAllowed: (value: boolean) => {
      allowed = value;
      for (const listener of [...listeners]) listener();
    },
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

async function playing(r: ReturnType<typeof rig>, url = URL1): Promise<FakePort> {
  r.answers.push({ kind: 'ok', url });
  r.session.start();
  await r.flush();
  const port = r.ports.at(-1) as FakePort;
  port.emit({ kind: 'ready' });
  port.emit({ kind: 'playing', playing: true });
  return port;
}

describe('video session (EVM-143 AC2, AC3, AC4, AC5)', () => {
  it('EVM-143 AC2: nothing is requested or created before "Odtwórz"; start asks once for the address, loads it and plays when ready', async () => {
    const r = rig();
    expect(r.phase()).toBe('idle');
    expect(r.requests).toHaveLength(0);
    expect(r.ports).toHaveLength(0);
    const port = await playing(r);
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0]).toMatchObject({ workOrderId: 'o1', mediaAssetId: 'm1' });
    expect(port.loads).toEqual([{ url: URL1, startAt: 0 }]);
    expect(port.calls).toEqual(['play']);
    expect(r.phase()).toBe('playing');
  });

  it('EVM-143 AC2: pause and play are the one button; the film that ended plays again from the start', async () => {
    const r = rig();
    const port = await playing(r);
    r.session.toggle();
    port.emit({ kind: 'playing', playing: false });
    expect(r.phase()).toBe('paused');
    r.session.toggle();
    port.emit({ kind: 'playing', playing: true });
    expect(r.phase()).toBe('playing');
    port.emit({ kind: 'time', seconds: 9 });
    port.emit({ kind: 'ended' });
    expect(r.phase()).toBe('ended');
    r.answers.push({ kind: 'ok', url: URL2 });
    r.session.start();
    await r.flush();
    expect(port.loads.at(-1)).toEqual({ url: URL2, startAt: 0 });
  });

  it('EVM-143 AC2: start while paused only plays; while loading or playing it does nothing (no second request)', async () => {
    const r = rig();
    const port = await playing(r);
    r.session.start();
    expect(r.requests).toHaveLength(1);
    port.emit({ kind: 'playing', playing: false });
    r.session.start();
    expect(port.calls.filter((call) => call === 'play')).toHaveLength(2);
    expect(r.requests).toHaveLength(1);
  });

  it('EVM-143 AC3: an expired address gets ONE silent refresh and playback resumes from the same second', async () => {
    const r = rig();
    const port = await playing(r);
    port.emit({ kind: 'time', seconds: 42 });
    port.at = 42.5;
    r.answers.push({ kind: 'ok', url: URL2 });
    port.emit({ kind: 'error' });
    expect(r.phase()).toBe('loading');
    await r.flush();
    expect(r.requests).toHaveLength(2);
    expect(port.loads.at(-1)).toEqual({ url: URL2, startAt: 42.5 });
    expect(r.ports).toHaveLength(1);
    port.emit({ kind: 'ready' });
    port.emit({ kind: 'playing', playing: true });
    expect(r.phase()).toBe('playing');
  });

  it('EVM-143 AC3: a second error without progress is "failed"; "Spróbuj ponownie" starts a new run with a new player', async () => {
    const r = rig();
    const port = await playing(r);
    r.answers.push({ kind: 'ok', url: URL2 });
    port.emit({ kind: 'error' });
    await r.flush();
    port.emit({ kind: 'error' });
    expect(r.phase()).toBe('failed');
    expect(port.released).toBe(true);
    expect(r.session.getSnapshot().port).toBeNull();
    expect(MAX_SILENT_REFRESHES).toBe(1);
    const second = await playing(r, URL1);
    expect(second).not.toBe(port);
    expect(r.phase()).toBe('playing');
  });

  it('EVM-143 AC3: progress after a restart clears the count, so a long film whose address expires again is refreshed again', async () => {
    const r = rig();
    const port = await playing(r);
    for (let round = 1; round <= 3; round += 1) {
      port.at = round * 300;
      port.emit({ kind: 'time', seconds: round * 300 });
      r.answers.push({ kind: 'ok', url: URL2 });
      port.emit({ kind: 'error' });
      await r.flush();
      expect(r.phase()).toBe('loading');
      port.emit({ kind: 'ready' });
      port.emit({ kind: 'playing', playing: true });
      port.emit({ kind: 'time', seconds: round * 300 + 2 });
    }
    expect(r.requests).toHaveLength(4);
    expect(r.phase()).toBe('playing');
  });

  it('EVM-143 AC3: 403 and 404 of the issue are "unavailable" (no retry), 429 and other failures are "failed" - nothing repeats by itself, no player is left', async () => {
    for (const [answer, phase] of [
      [{ kind: 'forbidden' }, 'unavailable'],
      [{ kind: 'not_found' }, 'unavailable'],
      [{ kind: 'rate_limited' }, 'failed'],
      [{ kind: 'failed' }, 'failed'],
    ] as const) {
      const r = rig();
      r.answers.push(answer);
      r.session.start();
      await r.flush();
      expect(r.phase()).toBe(phase);
      expect(r.requests).toHaveLength(1);
      expect(r.ports).toHaveLength(0);
    }
    const r = rig();
    r.answers.push({ kind: 'not_found' });
    r.session.start();
    await r.flush();
    r.session.start();
    expect(r.requests).toHaveLength(1);
  });

  it('EVM-143 AC3: an error of the issue request itself (a thrown request) is "failed", with no detail kept', async () => {
    const r = rig();
    const viewer = {
      isAllowed: () => true,
      subscribe: () => () => undefined,
      requestVideoUrl: () => Promise.reject(new Error('https://bucket.example.test/x?X-Amz-Signature=SECRET')),
    };
    const session = new VideoSession({
      viewer,
      createPort: () => new FakePort(),
      isOnline: () => true,
      workOrderId: 'o',
      mediaAssetId: 'm',
    });
    session.start();
    await r.flush();
    expect(session.getSnapshot()).toEqual({ phase: 'failed', port: null });
    expect(JSON.stringify(session.getSnapshot())).not.toMatch(/Amz|SECRET/);
  });

  it('EVM-143 AC4: offline at the start is "offline" without a request; coming back does not start by itself; a manual start works', async () => {
    const r = rig();
    r.setOnline(false);
    r.session.start();
    expect(r.phase()).toBe('offline');
    expect(r.requests).toHaveLength(0);
    r.setOnline(true);
    await r.flush();
    expect(r.phase()).toBe('offline');
    expect(r.requests).toHaveLength(0);
    await playing(r);
    expect(r.phase()).toBe('playing');
  });

  it('EVM-143 AC4: the network lost during playback (a player error while offline) is "offline", the player is released, no refresh is asked', async () => {
    const r = rig();
    const port = await playing(r);
    r.setOnline(false);
    port.emit({ kind: 'error' });
    expect(r.phase()).toBe('offline');
    expect(port.released).toBe(true);
    expect(r.requests).toHaveLength(1);
  });

  it('EVM-143 AC4: a failed issue of the address while offline says "offline", not "failed"', async () => {
    const r = rig();
    r.answers.push({ kind: 'failed' });
    r.session.start();
    r.setOnline(false);
    await r.flush();
    expect(r.phase()).toBe('offline');
  });

  it('EVM-143 AC5: the lock, the hidden-data mode or the background (the viewer loses its permission) pause and release the player; the phase is idle; a late event does nothing', async () => {
    const r = rig();
    const port = await playing(r);
    r.setAllowed(false);
    expect(port.calls.slice(-2)).toEqual(['pause', 'release']);
    expect(r.phase()).toBe('idle');
    expect(r.session.getSnapshot().port).toBeNull();
    const before = r.phases.length;
    port.emit({ kind: 'playing', playing: true });
    port.emit({ kind: 'ready' });
    port.emit({ kind: 'error' });
    expect(r.phases).toHaveLength(before);
    expect(port.calls.filter((call) => call === 'play')).toHaveLength(1);
    // nothing starts by itself when the permission comes back
    r.setAllowed(true);
    await r.flush();
    expect(r.phase()).toBe('idle');
    expect(r.requests).toHaveLength(1);
  });

  it('EVM-143 AC5: the request for the address that is in flight is aborted and its late answer is dropped - no player is created', async () => {
    const r = rig();
    r.session.start();
    await r.flush();
    const signal = r.requests[0]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    r.setAllowed(false);
    expect(signal.aborted).toBe(true);
    r.held[0]?.({ kind: 'ok', url: URL1 });
    await r.flush();
    expect(r.ports).toHaveLength(0);
    expect(r.phase()).toBe('idle');
  });

  it('EVM-143 AC5: start is refused while the viewer does not allow requests; an "aborted" answer of the viewer leaves the session idle', async () => {
    const r = rig();
    r.setAllowed(false);
    r.session.start();
    expect(r.requests).toHaveLength(0);
    expect(r.phase()).toBe('idle');
    r.setAllowed(true);
    r.answers.push({ kind: 'aborted' });
    r.session.start();
    await r.flush();
    expect(r.phase()).toBe('idle');
    expect(r.ports).toHaveLength(0);
  });

  it('EVM-143 AC5: closing the screen (dispose) releases the player, stops listening to the viewer and ignores everything after', async () => {
    const r = rig();
    const port = await playing(r);
    r.session.dispose();
    expect(port.released).toBe(true);
    r.session.start();
    expect(r.requests).toHaveLength(1);
    r.setAllowed(false);
    r.setAllowed(true);
    port.emit({ kind: 'error' });
    expect(r.requests).toHaveLength(1);
    expect(r.phase()).toBe('idle');
  });

  it('EVM-143 AC5: stop on an idle session changes nothing; a released player ignores load (the port contract)', () => {
    const r = rig();
    const before = r.phases.length;
    r.session.stop();
    expect(r.phases).toHaveLength(before);
    const port = new FakePort();
    port.release();
    port.load(URL1, 0);
    expect(port.loads).toHaveLength(0);
  });
});
