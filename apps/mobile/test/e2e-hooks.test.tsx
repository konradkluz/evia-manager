import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { E2eHooks as Slot, deviceOverrides as releaseOverrides } from '../src/e2e-hooks';
import { NO_OVERRIDES } from '../src/device-guard/overrides';
import {
  E2E_HOOKS_MARKER,
  E2E_MEDIA_WORK_ORDER,
  E2E_USERS,
  E2eHooks,
  deviceOverrides,
  sentinel,
  statusLine,
  syntheticRecord,
  type E2eHooksDeps,
} from '../src/e2e-hooks/panel';
import { WIPE_MARKER_FILE, wipeFaultForE2e, type OpenResult } from '../src/storage/local-data';
import { boot, newDevice, type Device } from './storage/fakes';
import { NodeSqliteEngine, newDisk, removeDisk, type TestDisk } from './storage/node-sqlite-engine';

/** What the stand-in session received from the capture hook: the requests of the pipeline and the pictures it asked for. */
const mockCapture = {
  requests: [] as { workOrderId: string; category: string }[],
  pictures: [] as { id: string; seed: number }[],
  failAt: null as number | null,
  noUploads: false,
  films: [] as { id: string; seed: number; bytes: number }[],
  filmRequests: [] as { workOrderId: string; category: string }[],
  filmProgress: [] as { duration: number; fileSize: number }[],
  filmStart: 'ok' as 'ok' | 'busy' | 'busy_once' | 'no_space',
  filmSave: 'ok' as 'ok' | 'save_failed',
};
jest.mock('../src/e2e-hooks/synthetic-picture', () => ({
  saveSyntheticPicture: (id: string, seed: number) => {
    mockCapture.pictures.push({ id, seed });
    return Promise.resolve({ uri: `file:///synthetic/cache/Camera/${id}.jpg` });
  },
}));
jest.mock('../src/e2e-hooks/synthetic-video', () => ({
  saveSyntheticVideo: (id: string, seed: number, bytes: number) => {
    mockCapture.films.push({ id, seed, bytes });
    return Promise.resolve({ uri: `file:///synthetic/cache/Camera/${id}.mp4` });
  },
}));
jest.mock('../src/session', () => ({
  sessionPorts: () => ({
    media: { getSnapshot: () => ({ notifications: 'granted', files: [] }) },
    newId: () => '0194c2a0-0000-7000-8000-0000000000b1',
    sync: undefined,
  }),
  sessionMediaUploads: () =>
    mockCapture.noUploads
      ? null
      : {
          add: () => Promise.resolve({ ok: true }),
          // the pipeline of the session: it asks the source for the picture exactly once per shot, like the real one
          capturePipeline: (
            takePicture: () => Promise<{ uri: string } | null>,
            video?: { record: (options: unknown) => Promise<{ uri: string } | null> },
          ) => ({
            // EVM-110: a film - the pipeline asks the source of the film for the file exactly once per recording, like the real one
            startVideo: (request: { workOrderId: string; category: string }) => {
              mockCapture.filmRequests.push(request);
              if (mockCapture.filmStart === 'busy_once') {
                mockCapture.filmStart = 'ok';
                return { ok: false, code: 'busy' };
              }
              if (mockCapture.filmStart !== 'ok') return { ok: false, code: mockCapture.filmStart };
              const recorded = video?.record({}) ?? Promise.resolve(null);
              return {
                ok: true,
                recording: {
                  progress: (event: { duration: number; fileSize: number }) => mockCapture.filmProgress.push(event),
                  done: recorded.then(() =>
                    mockCapture.filmSave === 'ok'
                      ? { ok: true, assetId: 'f', sizeBytes: 1, durationMs: 20_000, end: 'stopped' }
                      : { ok: false, code: 'save_failed' },
                  ),
                },
              };
            },
            capture: async (request: { workOrderId: string; category: string }) => {
              mockCapture.requests.push(request);
              if (mockCapture.failAt === mockCapture.requests.length) return { ok: false, code: 'no_space' };
              await takePicture();
              return { ok: true, assetId: 'a', sizeBytes: 1 };
            },
          }),
        },
}));

const metrics = { frame: { x: 0, y: 0, width: 360, height: 760 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const inProvider = (element: ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>;

let disk: TestDisk;
let device: Device;
beforeEach(() => {
  renders = 0;
  disk = newDisk();
  device = newDevice(disk);
  wipeFaultForE2e.afterStep = null;
});
afterEach(() => {
  removeDisk(disk);
});

function depsOf(): E2eHooksDeps {
  let clock = 1000;
  return {
    host: boot(device).host,
    deleteDatabaseKey: () => {
      device.key = null;
      return Promise.resolve();
    },
    wipeFault: wipeFaultForE2e,
    copyEngine: () => new NodeSqliteEngine(disk, 'evia-copy.db'),
    now: () => (clock += 100),
  };
}

/** The real host of `deps` whose `openForUser` answers a fixed outcome. */
const answering = (deps: E2eHooksDeps, outcome: OpenResult): E2eHooksDeps['host'] => ({
  openForUser: () => Promise.resolve(outcome),
  facts: () => deps.host.facts(),
  probe: (engine) => deps.host.probe(engine),
  wipeCompanyData: () => deps.host.wipeCompanyData(),
});

async function tap(id: string): Promise<void> {
  await act(async () => {
    await fireEvent.press(screen.getByTestId(id));
    await Promise.resolve();
  });
  // the actions run on the node:sqlite engine, which yields to the event loop on every statement
  await waitFor(
    () => {
      const line = screen.queryByTestId('e2e-status');
      if (line !== null) expect(String(line.props.children)).not.toBe('busy=yes');
    },
    { timeout: 10_000 },
  );
}

async function type(id: string, value: string): Promise<void> {
  await act(async () => {
    await fireEvent.changeText(screen.getByTestId(id), value);
    await Promise.resolve();
  });
}

async function expectStatus(value: string): Promise<void> {
  await waitFor(
    () => {
      expect(status()).toBe(value);
    },
    { timeout: 10_000 },
  );
}

const status = (): string => String(screen.getByTestId('e2e-status').props.children);

let renders = 0;
/** Renders the panel (a new process: a new component with its own deps) and opens it. */
async function opened(deps: E2eHooksDeps = depsOf()): Promise<E2eHooksDeps> {
  renders += 1;
  const element = inProvider(<E2eHooks key={renders} deps={deps} />);
  if (renders === 1) await render(element);
  else
    await act(async () => {
      await screen.rerender(element);
      await Promise.resolve();
    });
  await tap(E2E_HOOKS_MARKER);
  return deps;
}

describe('e2e hooks of the local store (EVM-093 AC1, AC3, AC5–AC7)', () => {
  it('EVM-093 AC1: the slot bundled outside the e2e variant renders nothing', async () => {
    await render(<Slot />);
    expect(screen.queryByTestId(E2E_HOOKS_MARKER)).toBeNull();
    expect(screen.toJSON()).toBeNull();
  });

  it('EVM-093 AC1: the panel is hidden behind one 48 dp toggle carrying the marker; the status shows codes and numbers only', async () => {
    await render(inProvider(<E2eHooks deps={depsOf()} />));
    expect(screen.queryByTestId('e2e-status')).toBeNull();
    await tap(E2E_HOOKS_MARKER);
    await expectStatus('open=none');
    await tap('e2e-close');
    expect(screen.getByTestId(E2E_HOOKS_MARKER)).toBeOnTheScreen();
  });

  it('EVM-093 AC1, AC3: user A signs in, appends entries carrying the sentinel; the count is shown after every append resolved', async () => {
    await opened();
    await tap('e2e-login-a');
    await expectStatus('open=unlocked;queue=0;identity=new;pull=first');
    await type('e2e-count', '19');
    await tap('e2e-append');
    await expectStatus('open=unlocked;appended=19;queue=19');
    await type('e2e-count', 'x');
    await tap('e2e-append');
    await expectStatus('open=unlocked;appended=1;queue=20');
    await tap('e2e-facts');
    await expectStatus('open=yes;cipher_version=4.17.0 community;temp_store=2;wipe_pending=no;queue=20');
    expect(status()).not.toContain(sentinel());
  });

  it('EVM-093 AC7: A keeps 5 entries; B is refused with the number only; after the wipe B starts empty as a new device', async () => {
    await opened();
    await tap('e2e-login-a');
    await type('e2e-count', '5');
    await tap('e2e-append');
    await tap('e2e-end-session');
    await expectStatus('open=locked');
    await tap('e2e-login-b');
    await expectStatus('open=owner_mismatch;queue=5');
    await tap('e2e-append');
    await expectStatus('error=locked');
    await tap('e2e-wipe');
    await expectStatus('wipe=done');
    await tap('e2e-login-b');
    await expectStatus('open=unlocked;queue=0;identity=new;pull=first');
    // A signs in after B: the queue belongs to B now
    await tap('e2e-end-session');
    await tap('e2e-login-a');
    await expectStatus('open=owner_mismatch;queue=0');
  });

  it('EVM-093 AC7: after the end of a session the same user finds the queue and the installation identity kept', async () => {
    await opened();
    await tap('e2e-login-a');
    await type('e2e-count', '5');
    await tap('e2e-append');
    await tap('e2e-end-session');
    await tap('e2e-login-a');
    await expectStatus('open=unlocked;queue=5;identity=kept;pull=no');
    expect(E2E_USERS).toEqual({ a: 'e2e-user-a', b: 'e2e-user-b' });
  });

  it('EVM-093 AC5: a deleted key gives the blocking message after sign-in; "Rozumiem" creates a new database for a new device', async () => {
    const deps = depsOf();
    await opened(deps);
    await tap('e2e-login-a');
    await type('e2e-count', '3');
    await tap('e2e-append');
    await tap('e2e-delete-key');
    await expectStatus('key=deleted');
    // a new process: the native handles are closed, a new host runs on the same device
    for (const handle of disk.handles) if (handle.isOpen) handle.close();
    await opened({ ...deps, host: boot(device).host });
    await tap('e2e-login-a');
    expect(screen.getByTestId('local-data-lost')).toBeOnTheScreen();
    await expectStatus('open=data_lost;reason=key_missing');
    await tap('local-data-lost-ack');
    await expectStatus('open=unlocked;queue=0;identity=new;pull=first');
  });

  it('EVM-093 AC6: the wipe fault leaves the wipe incomplete with the marker; a copy taken before the wipe does not open', async () => {
    const deps = await opened();
    await tap('e2e-login-a');
    await tap('e2e-append');
    new NodeSqliteEngine(disk).copyTo(new NodeSqliteEngine(disk, 'evia-copy.db'));
    await type('e2e-wipe-fault', ' database_file ');
    await tap('e2e-wipe');
    await expectStatus('wipe=incomplete');
    expect(device.files.has(WIPE_MARKER_FILE)).toBe(true);
    expect(deps.wipeFault.afterStep).toBeNull();
    await type('e2e-wipe-fault', '');
    await tap('e2e-wipe');
    await expectStatus('wipe=done');
    await tap('e2e-login-b');
    await tap('e2e-probe');
    await expectStatus('probe=not_a_database');
  });

  it('EVM-093 AC5: a failing action shows a fixed code, never the error text', async () => {
    await opened({ ...depsOf(), deleteDatabaseKey: () => Promise.reject(new Error('secret detail /data/x')) });
    await tap('e2e-delete-key');
    await expectStatus('error=action_failed');
  });

  it('EVM-093 AC1: other outcomes of opening are shown by their kind and code', async () => {
    const deps = depsOf();
    await opened({ ...deps, host: answering(deps, { kind: 'unavailable', code: 'busy' }) });
    await tap('e2e-login-a');
    await expectStatus('open=unavailable;reason=busy');
    await opened({ ...deps, host: answering(deps, { kind: 'update_required' }) });
    await tap('e2e-login-a');
    await expectStatus('open=update_required');
    await tap('e2e-facts');
    await expectStatus('open=no;cipher_version=none;temp_store=none;wipe_pending=no;queue=locked');
  });

  it('EVM-093 AC1: synthetic records belong to the given user and carry the sentinel in the payload only', () => {
    const record = syntheticRecord(E2E_USERS.a, 7);
    expect(record.ownerUserId).toBe('e2e-user-a');
    expect(JSON.stringify(record.payload)).toContain('EVM093-SENTINEL');
    expect(record.mutationId).not.toBe(syntheticRecord(E2E_USERS.a, 8).mutationId);
    expect(statusLine({ a: 1, b: 'x' })).toBe('a=1;b=x');
  });

  it('EVM-101 AC1, AC2, AC3 (security K7): the panel moves the screen lock, the contact time and the background time; the release slot has no overrides', async () => {
    expect(releaseOverrides).toBeNull();
    // the emulator of the scenarios has no screen lock: the e2e variant starts with the answer "locked"
    expect(deviceOverrides.screenSecure).toBe(true);
    expect(deviceOverrides.autoUnlock).toBe(true);
    Object.assign(deviceOverrides, NO_OVERRIDES);
    await opened();
    await tap('e2e-lock-off');
    expect(deviceOverrides.screenSecure).toBe(false);
    await tap('e2e-lock-real');
    expect(deviceOverrides.screenSecure).toBeNull();
    await tap('e2e-contact-5');
    expect(deviceOverrides.contactShiftMs).toBe(5 * 86_400_000);
    await tap('e2e-contact-8');
    expect(deviceOverrides.contactShiftMs).toBe(8 * 86_400_000);
    await tap('e2e-clock-back');
    expect(deviceOverrides.contactShiftMs).toBe(-86_400_000);
    await tap('e2e-contact-reset');
    expect(deviceOverrides.contactShiftMs).toBe(0);
    await tap('e2e-background-6');
    expect(deviceOverrides.backgroundShiftMs).toBe(360_000);
    await expectStatus('device=background_6m');
    // EVM-146 AC1: the hold keeps the app locked so that the tree of views under the cover can be read
    await tap('e2e-unlock-hold');
    expect(deviceOverrides.unlockHeld).toBe(true);
    await expectStatus('device=unlock_held');
    Object.assign(deviceOverrides, NO_OVERRIDES);
  });
});

describe('e2e hooks of the synchronization (EVM-107 AC6)', () => {
  it('EVM-107 AC6: "add notes" puts N notes into the durable queue of the session and reports the count only after they were saved; the status line has codes and numbers only', async () => {
    const calls: string[] = [];
    let unsent = 0;
    const snapshot = {
      active: true,
      online: false,
      syncing: false,
      initialLoad: 'done' as const,
      firstPull: { step: 1 as const, received: 0, slow: false, failure: null, attempts: 0, retryAt: null },
      lastSuccessAt: null,
      counts: { pending: 0, retrying: 0, blocked: 0, attention: 0, unsent: 0 },
      failure: null,
      retryAt: null,
      resyncing: false,
      paused: null,
    };
    const sync = {
      enqueue: (input: { type: string; payload: unknown }) => {
        calls.push(input.type);
        unsent += 1;
        return Promise.resolve({ ok: true as const });
      },
      getSnapshot: () => ({ ...snapshot, counts: { ...snapshot.counts, unsent } }),
      trigger: () => undefined,
    };
    const deps: E2eHooksDeps = { ...depsOf(), sync: () => sync };
    await opened(deps);
    await type('e2e-count', '5');
    await tap('e2e-sync-add');
    await expectStatus('sync_added=5;unsent=5');
    expect(calls).toEqual(['CreateNote', 'CreateNote', 'CreateNote', 'CreateNote', 'CreateNote']);
    await tap('e2e-sync-status');
    await expectStatus('sync=active;initial=done;unsent=5;failure=none;last=none');
    expect(status()).not.toMatch(/e2e note|body|token/);
  });
});

describe('e2e hooks of the files (EVM-130 AC1, AC8; media block)', () => {
  const asset = '0194c2a0-0000-7000-8000-0000000000a1';
  const mediaDeps = (overrides: Partial<ReturnType<NonNullable<E2eHooksDeps['media']>>> = {}) => {
    const added: unknown[] = [];
    const injected: { assetId: string; sizeBytes: number; seed: number }[] = [];
    const media: NonNullable<E2eHooksDeps['media']> = () => ({
      newId: () => asset,
      inject: (assetId, sizeBytes, seed) => {
        injected.push({ assetId, sizeBytes, seed });
        return Promise.resolve({ sizeBytes, sha256: 'd'.repeat(64) });
      },
      add: (item) => {
        added.push(item);
        return Promise.resolve({ ok: true as const });
      },
      view: {
        getSnapshot: () => ({
          notifications: 'denied' as const,
          files: [
            {
              assetId: asset,
              workOrderId: '10000000-0000-4000-8000-000000000001',
              status: 'waiting' as const,
              percent: null,
              sizeBytes: 1,
              actions: [],
              code: null,
              updatedAt: 1,
              category: null,
              mediaType: 'photo' as const,
              capturedAt: 1,
            },
            {
              assetId: asset,
              workOrderId: '10000000-0000-4000-8000-000000000001',
              status: 'uploading' as const,
              percent: 3,
              sizeBytes: 1,
              actions: [],
              code: null,
              updatedAt: 1,
              category: null,
              mediaType: 'photo' as const,
              capturedAt: 1,
            },
            {
              assetId: asset,
              workOrderId: '10000000-0000-4000-8000-000000000001',
              status: 'error' as const,
              percent: null,
              sizeBytes: 1,
              actions: [],
              code: null,
              updatedAt: 1,
              category: null,
              mediaType: 'photo' as const,
              capturedAt: 1,
            },
          ],
        }),
      },
      ...overrides,
    });
    return { deps: { ...depsOf(), media } satisfies E2eHooksDeps, added, injected };
  };

  it('EVM-130 AC1: the hook writes a synthetic file of the requested size (random content made natively), then the command; the status carries codes and numbers only', async () => {
    const { deps, added, injected } = mediaDeps();
    await opened(deps);
    await type('e2e-media-mib', '40');
    await tap('e2e-media-inject');
    await expectStatus(`media_added=1;asset=${asset};bytes=${String(40 * 1024 * 1024)}`);
    expect(injected).toHaveLength(1);
    expect(injected[0]).toMatchObject({ assetId: asset, sizeBytes: 40 * 1024 * 1024 });
    expect(added).toEqual([{ assetId: asset, workOrderId: '30000000-0000-4000-8000-000000000001', mediaType: 'photo', category: 'other' }]);
    await type('e2e-media-mib', 'x');
    await tap('e2e-media-inject');
    expect(injected[1]?.sizeBytes).toBe(1024 * 1024);
    await type('e2e-media-mib', '9999');
    await tap('e2e-media-inject');
    expect(injected[2]?.sizeBytes).toBe(256 * 1024 * 1024);
  });

  it('EVM-130 AC8: the states of the files are one line of counts; a package without the hook, a failing add or a missing session say so by a code', async () => {
    const { deps } = mediaDeps();
    await opened(deps);
    await tap('e2e-media-status');
    await expectStatus('files=3;waiting=1;uploading=1;failed=1;attention=0;notifications=denied');

    const nohook = mediaDeps({ inject: () => Promise.resolve(null) });
    await opened(nohook.deps);
    await tap('e2e-media-inject');
    await expectStatus('error=no_media_hook');
    expect(nohook.added).toEqual([]);

    const refusing = mediaDeps({ add: () => Promise.resolve({ ok: false as const, code: 'enqueue_failed' as const }) });
    await opened(refusing.deps);
    await tap('e2e-media-inject');
    await expectStatus('error=enqueue_failed');
  });

  it('EVM-130 AC8: the slot of every other package carries no media hook (only the panel of the e2e variant calls the native injection)', async () => {
    await render(<Slot />);
    expect(screen.toJSON()).toBeNull();
    expect(releaseOverrides).toBeNull();
  });
});

describe('the batch capture hook (EVM-108 AC7; security requirement 20)', () => {
  beforeEach(() => {
    mockCapture.requests = [];
    mockCapture.pictures = [];
    mockCapture.failAt = null;
    mockCapture.noUploads = false;
  });

  it('EVM-108 AC7: "media: capture N" takes N shots one after another through the capture pipeline, the categories in turn, each with its own seed, and confirms only after the last one', async () => {
    const shots: { category: string; seed: number }[] = [];
    const capture: NonNullable<E2eHooksDeps['capture']> = () => ({
      shoot: (request, seed) => {
        shots.push({ category: request.category, seed });
        expect(request.workOrderId).toBe(E2E_MEDIA_WORK_ORDER);
        return Promise.resolve({ ok: true as const, assetId: 'a', sizeBytes: 1 });
      },
    });
    await render(inProvider(<E2eHooks deps={{ ...depsOf(), capture }} />));
    await tap(E2E_HOOKS_MARKER);
    await type('e2e-capture-count', '9');
    await tap('e2e-capture-batch');
    await expectStatus('capture_added=9');
    expect(shots.map((shot) => shot.category)).toEqual([
      'site_survey',
      'before_work',
      'in_progress',
      'completed_work',
      'defect',
      'measurement',
      'other',
      'site_survey',
      'before_work',
    ]);
    // every shot has its own seed, hence its own content and SHA-256
    expect(new Set(shots.map((shot) => shot.seed)).size).toBe(9);
  });

  it('EVM-108 AC7: the count is kept in 1..60; a shot the pipeline refuses stops the batch with the number saved so far and the code', async () => {
    const calls: number[] = [];
    const capture: NonNullable<E2eHooksDeps['capture']> = () => ({
      shoot: (_request, seed) => {
        calls.push(seed);
        return Promise.resolve(
          calls.length === 3 ? { ok: false as const, code: 'no_space' as const } : { ok: true as const, assetId: 'a', sizeBytes: 1 },
        );
      },
    });
    await render(inProvider(<E2eHooks deps={{ ...depsOf(), capture }} />));
    await tap(E2E_HOOKS_MARKER);
    await type('e2e-capture-count', '30');
    await tap('e2e-capture-batch');
    await expectStatus('capture_added=2;error=no_space');
    expect(calls).toHaveLength(3);
    calls.length = 0;
    await type('e2e-capture-count', 'x');
    await tap('e2e-capture-batch');
    await expectStatus('capture_added=1');
    // 9999 is kept to 60 — the batch would run 60 shots; the third is refused again, so the batch stops there
    await type('e2e-capture-count', '9999');
    calls.length = 0;
    await tap('e2e-capture-batch');
    expect(calls).toHaveLength(3);
    await expectStatus('capture_added=2;error=no_space');
  });

  it('EVM-108 AC7: without injected deps the hook goes through the real wiring — the pipeline of the session, a synthetic picture under a name of the camera cache, the same request as the camera screen', async () => {
    await render(inProvider(<E2eHooks />));
    await tap(E2E_HOOKS_MARKER);
    await type('e2e-capture-count', '2');
    await tap('e2e-capture-batch');
    await expectStatus('capture_added=2');
    expect(mockCapture.requests).toEqual([
      { workOrderId: E2E_MEDIA_WORK_ORDER, category: 'site_survey' },
      { workOrderId: E2E_MEDIA_WORK_ORDER, category: 'before_work' },
    ]);
    expect(mockCapture.pictures).toHaveLength(2);
    expect(mockCapture.pictures[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(mockCapture.pictures[0]?.seed).not.toBe(mockCapture.pictures[1]?.seed);
  });

  it('EVM-108 AC7: a session without the queue of files answers camera_failed and writes no picture; a refusal of the pipeline is reported', async () => {
    mockCapture.noUploads = true;
    await render(inProvider(<E2eHooks />));
    await tap(E2E_HOOKS_MARKER);
    await tap('e2e-capture-batch');
    await expectStatus('capture_added=0;error=camera_failed');
    expect(mockCapture.pictures).toEqual([]);
    mockCapture.noUploads = false;
    mockCapture.failAt = 1;
    await tap('e2e-capture-batch');
    await expectStatus('capture_added=0;error=no_space');
  });

  it('EVM-108 AC7: the temporary entry to the camera is gone — the flows reach the camera through the screens of the app', () => {
    expect(readFileSync(join(__dirname, '..', 'src', 'e2e-hooks', 'panel.tsx'), 'utf8')).not.toContain('e2e-camera-open');
  });
});

describe('the real wiring of the media hook (EVM-130 AC8)', () => {
  it('EVM-130 AC8: without injected deps the hook reads the files of the session; outside the e2e package the native injection is absent (a code, nothing written)', async () => {
    await render(inProvider(<E2eHooks />));
    await tap(E2E_HOOKS_MARKER);
    await tap('e2e-media-status');
    await expectStatus('files=0;waiting=0;uploading=0;failed=0;attention=0;notifications=granted');
    await tap('e2e-media-inject');
    await expectStatus('error=no_media_hook');
  });
});

describe('the synthetic film hook (EVM-110 AC8; SEC-110-18)', () => {
  beforeEach(() => {
    mockCapture.films = [];
    mockCapture.filmRequests = [];
    mockCapture.filmProgress = [];
    mockCapture.filmStart = 'ok';
    mockCapture.filmSave = 'ok';
    mockCapture.noUploads = false;
  });

  it('EVM-110 AC8: "media: capture video" saves N synthetic films of the given size one after another through the pipeline of the camera, each with its own seed, and confirms after the LAST', async () => {
    const shots: { category: string; seed: number; mib: number }[] = [];
    const captureVideo: NonNullable<E2eHooksDeps['captureVideo']> = () => ({
      shoot: (request, seed, mib) => {
        shots.push({ category: request.category, seed, mib });
        expect(request.workOrderId).toBe(E2E_MEDIA_WORK_ORDER);
        return Promise.resolve({ ok: true as const, assetId: 'a', sizeBytes: 1, durationMs: 1, end: 'stopped' as const });
      },
    });
    await render(inProvider(<E2eHooks deps={{ ...depsOf(), captureVideo }} />));
    await tap(E2E_HOOKS_MARKER);
    await type('e2e-video-mib', '96');
    await type('e2e-video-count', '3');
    await tap('e2e-capture-video');
    await expectStatus('video_added=3');
    expect(shots.map((shot) => shot.category)).toEqual(['site_survey', 'before_work', 'in_progress']);
    expect(shots.every((shot) => shot.mib === 96)).toBe(true);
    expect(new Set(shots.map((shot) => shot.seed)).size).toBe(3);
  });

  it('EVM-110 AC8: the size is kept in 1..128 MiB and the count in 1..60; a film the pipeline refuses stops the series with the number saved so far and the code', async () => {
    const calls: number[] = [];
    const captureVideo: NonNullable<E2eHooksDeps['captureVideo']> = () => ({
      shoot: (_request, _seed, mib) => {
        calls.push(mib);
        return Promise.resolve(
          calls.length === 2
            ? { ok: false as const, code: 'save_failed' as const }
            : { ok: true as const, assetId: 'a', sizeBytes: 1, durationMs: 1, end: 'stopped' as const },
        );
      },
    });
    await render(inProvider(<E2eHooks deps={{ ...depsOf(), captureVideo }} />));
    await tap(E2E_HOOKS_MARKER);
    await type('e2e-video-mib', '9999');
    await type('e2e-video-count', '5');
    await tap('e2e-capture-video');
    await expectStatus('video_added=1;error=save_failed');
    expect(calls).toEqual([128, 128]);
    calls.length = 0;
    await type('e2e-video-mib', '0');
    await type('e2e-video-count', '1');
    await tap('e2e-capture-video');
    await expectStatus('video_added=1');
    expect(calls).toEqual([1]);
  });

  it('EVM-110 AC8: without injected deps the film goes through the real wiring - the pipeline of the session, a synthetic MP4 of the asked size under a name of the camera cache, the same request as the camera screen', async () => {
    await render(inProvider(<E2eHooks />));
    await tap(E2E_HOOKS_MARKER);
    await type('e2e-video-mib', '64');
    await type('e2e-video-count', '2');
    await tap('e2e-capture-video');
    await expectStatus('video_added=2');
    expect(mockCapture.filmRequests).toEqual([
      { workOrderId: E2E_MEDIA_WORK_ORDER, category: 'site_survey' },
      { workOrderId: E2E_MEDIA_WORK_ORDER, category: 'before_work' },
    ]);
    expect(mockCapture.films.map((film) => film.bytes)).toEqual([64 * 1024 * 1024, 64 * 1024 * 1024]);
    expect(mockCapture.films[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(mockCapture.films[0]?.seed).not.toBe(mockCapture.films[1]?.seed);
    // the recording is told how big the film is (the length and the size of the progress of a real one)
    expect(mockCapture.filmProgress).toEqual([
      { duration: 20, fileSize: 64 * 1024 * 1024 },
      { duration: 20, fileSize: 64 * 1024 * 1024 },
    ]);
  });

  it('EVM-110 AC8: a series of films waits for the pipeline to let go of the previous film (it does so a moment after `done`) - no `busy` in the middle of a series', async () => {
    mockCapture.filmStart = 'busy_once';
    await render(inProvider(<E2eHooks />));
    await tap(E2E_HOOKS_MARKER);
    await type('e2e-video-mib', '8');
    await type('e2e-video-count', '2');
    await tap('e2e-capture-video');
    await expectStatus('video_added=2');
    // the first start was refused once and tried again; the second film followed
    expect(mockCapture.filmRequests).toHaveLength(3);
  });

  it('EVM-110 AC8: a session without the queue of files answers camera_failed and writes no film; a refusal to start and a failed save are reported', async () => {
    mockCapture.noUploads = true;
    await render(inProvider(<E2eHooks />));
    await tap(E2E_HOOKS_MARKER);
    await tap('e2e-capture-video');
    await expectStatus('video_added=0;error=camera_failed');
    expect(mockCapture.films).toEqual([]);
    mockCapture.noUploads = false;
    mockCapture.filmStart = 'no_space';
    await tap('e2e-capture-video');
    await expectStatus('video_added=0;error=no_space');
    mockCapture.filmStart = 'ok';
    mockCapture.filmSave = 'save_failed';
    await tap('e2e-capture-video');
    await expectStatus('video_added=0;error=save_failed');
  });

  it('EVM-110 AC8 SEC-110-18: the hook of the film lives in the e2e hooks only - nothing but the panel imports it, and the panel is the file the release package is refused for', () => {
    const src = join(__dirname, '..', 'src');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [],
      );
    const importers = walk(src)
      .filter((path) => !path.endsWith('synthetic-video.ts') && /synthetic-video/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(src.length + 1).replaceAll(String.fromCharCode(92), '/'));
    expect(importers).toEqual(['e2e-hooks/panel.tsx']);
    expect(readFileSync(join(src, 'e2e-hooks', 'panel.tsx'), 'utf8')).toContain('export const E2E_HOOKS_MARKER');
  });
});
