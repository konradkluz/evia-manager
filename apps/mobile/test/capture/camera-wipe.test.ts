// A picture left in the cache of the camera (`cacheDir/Camera/`) when the phone is wiped or the user signs out (EVM-108, security requirement 13):
// the native step of the wipe is the FIRST step, and when anything of the cache is left it FAILS CLOSED - the wipe is "incomplete" and is repeated at
// the next start before anything else is deleted. The module of the phone is a stand-in with a camera cache; the real deletion is tested on the JVM
// (`WipeChain`).
import type { EviaUploadModule } from '../../modules/evia-upload/src';
import { CapturePipeline } from '../../src/capture/capture-pipeline';
import { createSessionPorts } from '../../src/session';

jest.mock('react', () => ({ ...jest.requireActual<typeof import('react')>('react'), useContext: () => null }));
jest.mock('../../src/storage', () => {
  const host = {
    installationProof: jest.fn(() => Promise.resolve(null)),
    unsentItemCountBeforeSignIn: jest.fn(() => Promise.resolve(0)),
    openForUser: jest.fn(),
    registerWipeStep: jest.fn(),
    prepare: jest.fn(() => Promise.resolve('ready')),
    wipeCompanyData: jest.fn(() => Promise.resolve('done')),
    unsentItemCount: jest.fn(() => Promise.resolve(0)),
    pendingWipeConfirmation: jest.fn(() => Promise.resolve(null)),
    clearWipeConfirmation: jest.fn(() => Promise.resolve()),
  };
  return {
    localData: () => host,
    randomSource: () => ({ getRandomValues: (bytes: Uint8Array) => crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>) }),
  };
});

const config = { apiBaseUrl: 'https://manager.example.test', platform: 'android', appVersion: '0.4.0', buildVariant: 'release' } as const;

/** The module of the phone as far as the wipe goes: the private folder of the originals and the cache of the camera. */
function phone(stuck: ReadonlySet<string> = new Set()) {
  const originals = new Set(['0194c2a0-0000-7000-8000-000000000001']);
  const cache = new Set(['Camera/leftover.jpg', 'Camera/import.tmp']);
  const fake = {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    sessionState: jest.fn(() => Promise.resolve({ state: 'signed_out', ownerId: null })),
    // like `WipeChain`: everything is removed that can be; `true` only when nothing is left
    wipeUploads: jest.fn(() => {
      originals.clear();
      for (const name of [...cache]) if (!stuck.has(name)) cache.delete(name);
      return Promise.resolve(cache.size === 0 && originals.size === 0);
    }),
  };
  return { fake, originals, cache, asModule: fake as unknown as EviaUploadModule };
}

function nativeStep(module: EviaUploadModule): () => Promise<void> {
  const { localData } = jest.requireMock<typeof import('../../src/storage')>('../../src/storage');
  const host = localData() as unknown as Record<string, jest.Mock>;
  host['registerWipeStep']?.mockClear();
  createSessionPorts(config, module);
  const [name, run, options] = host['registerWipeStep']?.mock.calls[0] as [string, () => Promise<void>, { first?: boolean }];
  expect(name).toBe('native_uploads');
  expect(options).toEqual({ first: true });
  return run;
}

describe('a picture left in the cache of the camera and the wipe of the phone (EVM-108; security 13)', () => {
  it('EVM-108 AC1: the wipe removes the originals AND the pictures and temporary files of the camera cache; the step ends well only when nothing is left', async () => {
    const { asModule, cache, originals } = phone();
    const run = nativeStep(asModule);
    await expect(run()).resolves.toBeUndefined();
    expect(cache.size).toBe(0);
    expect(originals.size).toBe(0);
  });

  it('EVM-108 AC1: a file that cannot be removed from the cache makes the step fail closed (the wipe is incomplete, repeated before anything else)', async () => {
    const { asModule, cache } = phone(new Set(['Camera/leftover.jpg']));
    const run = nativeStep(asModule);
    await expect(run()).rejects.toThrow('native wipe unfinished');
    expect([...cache]).toEqual(['Camera/leftover.jpg']);
  });

  it('EVM-108 AC1: a module that reports the wipe as unfinished is an unfinished wipe, never a finished one', async () => {
    const { fake, asModule } = phone();
    fake.wipeUploads.mockImplementationOnce(() => Promise.resolve(false));
    const run = nativeStep(asModule);
    await expect(run()).rejects.toThrow('native wipe unfinished');
  });

  it('EVM-108 AC5 (EVM-130 AC5): a picture saved by the REAL capture pipeline is gone after the native step of the wipe', async () => {
    const { asModule, originals, cache } = phone();
    originals.clear();
    let n = 0;
    const pipeline = new CapturePipeline({
      takePicture: () => Promise.resolve({ uri: 'file:///cache/Camera/synthetic.jpg' }),
      native: {
        // the import makes the picture an original of the private folder (and takes it out of the cache), like the module
        importOriginal: (assetId) => {
          originals.add(assetId);
          return Promise.resolve('ok');
        },
        digestOriginal: () => Promise.resolve({ sizeBytes: 100, sha256: 'a'.repeat(64) }),
        cancelUpload: (assetId) => {
          originals.delete(assetId);
          return Promise.resolve(true);
        },
      },
      disk: { freeBytes: () => 10 * 1024 ** 3 },
      registerAndEnqueue: () => Promise.resolve({ ok: true }),
      now: () => Date.UTC(2026, 10, 15, 8, 0, 0),
      newId: () => `0194c2a0-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`,
    });
    expect((await pipeline.capture({ workOrderId: '10000000-0000-4000-8000-000000000001', category: 'other' })).ok).toBe(true);
    expect(originals.size).toBe(1);
    const run = nativeStep(asModule);
    await expect(run()).resolves.toBeUndefined();
    expect(originals.size).toBe(0);
    expect(cache.size).toBe(0);
  });
});
