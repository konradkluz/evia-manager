import { describe, expect, it } from 'vitest';

function fail(message: string): never {
  throw new Error(message);
}
import { readVector, runScenario, type ResumeFile } from '../conformance/upload.ts';
import { UploadEngine, type EngineDeps, type JobSnapshot, type PartRequest } from '../src/upload/index.ts';

const ASSET = 'asset-1';
const SNAPSHOT: JobSnapshot = {
  schemaVersion: 1,
  assetId: ASSET,
  size: 40,
  uploadSessionId: 'sess-1',
  idempotencyKey: 'key-1',
  partSize: 16,
  partCount: 3,
  completeSent: false,
  state: 'active',
  etags: {},
};

function harness(initial: JobSnapshot | null = null) {
  const saved: JobSnapshot[] = [];
  const requests: PartRequest[] = [];
  let snapshot = initial;
  const deps: EngineDeps = {
    api: {
      createSession: () => Promise.resolve({ id: 'sess-1', partSize: 16, partCount: 3 }),
      listParts: () => Promise.resolve([]),
      partUrl: (_id, part) =>
        Promise.resolve({ url: `https://store.example.test/b/${part}?X-Amz-Signature=sig`, contentLength: part === 3 ? 8 : 16 }),
      complete: () => Promise.resolve({ state: 'uploaded' }),
    },
    transport: {
      put: (request) => {
        requests.push(request);
        return Promise.resolve('"etag"');
      },
    },
    store: {
      load: () => Promise.resolve(snapshot),
      save: (value) => {
        snapshot = value;
        saved.push(value);
        return Promise.resolve();
      },
      clear: () => {
        snapshot = null;
        return Promise.resolve();
      },
    },
    allowedHosts: ['store.example.test'],
    sleep: () => Promise.resolve(),
    rng: () => 0,
    newId: (() => {
      let counter = 0;
      return () => `id-${++counter}`;
    })(),
  };
  return { deps, saved, requests };
}

describe('EVM-109 AC3: requests and persisted state of the reference engine', () => {
  it('EVM-109 AC3: a part request carries only Content-Length and never Authorization', async () => {
    const { deps, requests } = harness();
    expect(await new UploadEngine(deps).run(ASSET, 40)).toEqual({ type: 'uploaded' });
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(Object.keys(request.headers)).toEqual(['Content-Length']);
      expect(request.headers['Content-Length']).toBe(String(request.length));
    }
    expect(requests.map((request) => [request.offset, request.length])).toEqual([
      [0, 16],
      [16, 16],
      [32, 8],
    ]);
  });

  it('EVM-109 AC3: the persisted snapshot holds only allowlisted keys and no address, token or name', async () => {
    const { deps, saved } = harness();
    await new UploadEngine(deps).run(ASSET, 40);
    const allowed = new Set(Object.keys(SNAPSHOT));
    for (const snapshot of saved) {
      expect(Object.keys(snapshot).every((key) => allowed.has(key))).toBe(true);
      const text = JSON.stringify(snapshot);
      expect(text).not.toMatch(/https?:|X-Amz|Bearer|Signature|\/b\//i);
    }
    expect(saved.at(-1)?.etags).toEqual({ '1': '"etag"', '2': '"etag"', '3': '"etag"' });
  });

  it('EVM-109 AC1: a persisted plan that is inconsistent ends in needs_attention instead of sending', async () => {
    const { deps, requests } = harness({ ...SNAPSHOT, partCount: 9 });
    expect(await new UploadEngine(deps).run(ASSET, 40)).toEqual({ type: 'needs_attention', reason: 'plan_mismatch' });
    expect(requests).toHaveLength(0);
  });

  it('EVM-109 AC1: an error that is not an upload failure (a killed process) is never swallowed', async () => {
    const { deps } = harness();
    const broken: EngineDeps = { ...deps, transport: { put: () => Promise.reject(new Error('boom')) } };
    await expect(new UploadEngine(broken).run(ASSET, 40)).rejects.toThrow('boom');
  });

  it('EVM-109 AC1, EVM-130 AC5: a paused_revoked snapshot is resumed as active only by the explicit resume', async () => {
    const { deps, saved } = harness({ ...SNAPSHOT, state: 'paused_revoked' });
    expect(await new UploadEngine(deps).run(ASSET, 40, { resume: true })).toEqual({ type: 'uploaded' });
    expect(saved.every((snapshot) => snapshot.state !== 'paused_revoked')).toBe(true);
  });

  it('EVM-130 AC5: a paused_revoked snapshot without the explicit resume is refused, nothing is sent and the snapshot stays', async () => {
    const { deps, saved, requests } = harness({ ...SNAPSHOT, state: 'paused_revoked' });
    expect(await new UploadEngine(deps).run(ASSET, 40)).toEqual({ type: 'paused_revoked' });
    expect(await new UploadEngine(deps).run(ASSET, 40, { resume: false })).toEqual({ type: 'paused_revoked' });
    expect(requests).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });
});

describe('EVM-109 AC4: a divergence of a vector turns the test red', () => {
  it('EVM-109 AC4: a changed expectation is reported as a mismatch', async () => {
    const file = readVector<ResumeFile>('resume.json');
    const scenario = structuredClone(file.scenarios[0] ?? fail('no scenario'));
    const firstRun = scenario.runs[0] ?? fail('no run');
    firstRun.expect.calls = [...firstRun.expect.calls, 'put:1'];
    expect(await runScenario(scenario, file.defaults)).not.toEqual([]);
    const final = structuredClone(file.scenarios[0] ?? fail('no scenario'));
    final.final.objects = 2;
    expect(await runScenario(final, file.defaults)).not.toEqual([]);
  });
});
