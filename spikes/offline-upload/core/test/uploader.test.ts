import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store.ts';
import { uuidv7 } from '../src/uuid.ts';
import { deleteLocalIfVerified, markVerified, newJob, runUpload, type Checkpoint } from '../src/uploader.ts';
import { FakeServer } from './fakes.ts';

const SIZE = 30 * 1024 * 1024; // 4 parts of 8 MiB (last 6 MiB)
const mk = (deviceId = 'dev-1') =>
  newJob({
    assetId: uuidv7(),
    deviceId,
    filePath: '/sandbox/video.mp4',
    size: SIZE,
    sha256: 'a'.repeat(64),
    contentType: 'video/mp4',
  });
const setup = () => {
  const server = new FakeServer();
  const store = new MemoryStore();
  const sleeps: number[] = [];
  const deps = {
    api: server,
    transport: server,
    store,
    sleep: async (ms: number) => void sleeps.push(ms),
    rng: () => 0.5,
  };
  return { server, store, sleeps, deps };
};

class Killed extends Error {}
const killAt = (point: Checkpoint, nth = 1) => {
  let seen = 0;
  return (name: Checkpoint) => {
    if (name === point && ++seen === nth) throw new Killed();
  };
};

describe('EVM-011 AC1 reference upload engine', () => {
  it('EVM-011 AC1 uploads all parts once, completes, and records metrics', async () => {
    const { server, deps } = setup();
    const job = mk();
    expect(await runUpload(job, deps)).toBe('uploaded');
    expect(server.putLog.map((p) => p.n)).toEqual([1, 2, 3, 4]);
    expect(server.completed.has(job.assetId)).toBe(true);
    const saved = (await deps.store.load(job.assetId))!;
    expect(saved.state).toBe('uploaded');
    expect(saved.metrics).toMatchObject({ partPuts: 4, retries: 0, wastedBytes: 0 });
  });

  it('EVM-011 AC1 EVM-011 AC2 retries a network error with exponential backoff + jitter and finishes', async () => {
    const { server, sleeps, deps } = setup();
    server.failNextPuts = ['net', 'net', 503];
    const job = mk();
    expect(await runUpload(job, deps)).toBe('uploaded');
    expect((await deps.store.load(job.assetId))!.metrics.retries).toBe(3);
    // rng 0.5: ceilings 1000, 2000, 4000 -> delays 500, 1000, 2000
    expect(sleeps).toEqual([500, 1000, 2000]);
  });

  it('EVM-011 AC1 EVM-011 AC2 gives up after maxAttempts for one part and reports retry_later (no data loss)', async () => {
    const { server, deps } = setup();
    server.failNextPuts = Array(10).fill('net');
    const job = mk();
    expect(await runUpload(job, { ...deps, maxAttemptsPerPart: 3 })).toBe('retry_later');
    const saved = (await deps.store.load(job.assetId))!;
    expect(saved.state).toBe('uploading');
    expect(saved.metrics.retries).toBe(3);
    // The next scheduled run (network is back) completes the file.
    server.failNextPuts = [];
    expect(await runUpload(saved, deps)).toBe('uploaded');
  });

  it('EVM-011 AC1 treats 403 on a part as an expired URL: renews and repeats only that part', async () => {
    const { server, deps } = setup();
    server.failNextPuts = [403];
    const job = mk();
    expect(await runUpload(job, deps)).toBe('uploaded');
    const saved = (await deps.store.load(job.assetId))!;
    expect(saved.metrics.renewals).toBe(1);
    expect(saved.metrics.retries).toBe(0);
    expect(server.putLog.map((p) => p.n)).toEqual([1, 2, 3, 4]);
  });

  it('EVM-011 AC1 fails (not loops) when URL renewal keeps returning 403', async () => {
    const { server, deps } = setup();
    server.failNextPuts = [403, 403, 403, 403, 403];
    await expect(runUpload(mk(), { ...deps, maxRenewalsPerPart: 2 })).rejects.toThrow(/url_renewal_exhausted/);
  });

  for (const point of ['afterSession', 'afterPartPut', 'afterPartSaved', 'beforeComplete', 'afterCompleteBeforeSave'] as const) {
    it(`EVM-011 AC2 survives a kill at ${point}: restart resumes, no duplicate part with a known ETag, one object`, async () => {
      const { server, store, deps } = setup();
      const job = mk();
      await expect(runUpload(job, { ...deps, checkpoint: killAt(point, point.startsWith('afterPart') ? 2 : 1) })).rejects.toBeInstanceOf(
        Killed,
      );
      // "Restart": the process state is gone, only the persisted job and the server remain.
      const persisted = (await store.load(job.assetId)) ?? job;
      expect(await runUpload(persisted, deps)).toBe('uploaded');
      const perPart = new Map<number, number>();
      for (const p of server.putLog) perPart.set(p.n, (perPart.get(p.n) ?? 0) + 1);
      // Only the single PUT that finished without a saved ETag may legitimately be seen twice? No: ListParts adopts it.
      expect([...perPart.values()].every((c) => c === 1)).toBe(true);
      expect(server.completed.size).toBe(1);
      expect(server.sessions.size).toBe(1);
      expect((await store.load(job.assetId))!.state).toBe('uploaded');
    });
  }

  it('EVM-011 AC2 kill between server-side complete and the local state write: the re-run is a no-op success (idempotent complete)', async () => {
    const { server, store, deps } = setup();
    const job = mk();
    await expect(runUpload(job, { ...deps, checkpoint: killAt('afterCompleteBeforeSave') })).rejects.toBeInstanceOf(Killed);
    expect(server.completed.has(job.assetId)).toBe(true);
    const persisted = (await store.load(job.assetId))!;
    expect(persisted.state).toBe('uploading'); // local state is stale
    const puts = server.putLog.length;
    expect(await runUpload(persisted, deps)).toBe('uploaded');
    expect(server.putLog.length).toBe(puts);
    expect((await store.load(job.assetId))!.state).toBe('uploaded');
  });

  it('EVM-011 AC2 re-running the same asset after success creates no second session or object (dedup by assetId)', async () => {
    const { server, store, deps } = setup();
    const job = mk();
    await runUpload(job, deps);
    const saved = (await store.load(job.assetId))!;
    expect(await runUpload(saved, deps)).toBe('uploaded');
    expect(server.sessions.size).toBe(1);
    expect(server.putLog).toHaveLength(4);
  });

  it('EVM-011 AC2 skips parts the server already holds (ListParts is the source of truth, even if local state is lost)', async () => {
    const { server, deps } = setup();
    const job = mk();
    await expect(runUpload(job, { ...deps, checkpoint: killAt('afterPartSaved', 2) })).rejects.toBeInstanceOf(Killed);
    const fresh = mk(); // local state lost entirely: same asset id, empty job
    fresh.assetId = job.assetId;
    expect(await runUpload(fresh, deps)).toBe('uploaded');
    expect((await deps.store.load(job.assetId))!.metrics.skippedParts).toBe(2);
    expect(server.putLog.map((p) => p.n)).toEqual([1, 2, 3, 4]);
  });
});

describe('EVM-011 AC2 session revocation and ownership (SR-MOB-04, SR-SYNC-03, SR-SYNC-08)', () => {
  it('EVM-011 AC2 401 session_revoked pauses the job and keeps everything (nothing is deleted)', async () => {
    const { server, store, deps } = setup();
    const job = mk();
    await expect(runUpload(job, { ...deps, checkpoint: killAt('afterPartSaved', 2) })).rejects.toBeInstanceOf(Killed);
    server.revoked = true;
    const persisted = (await store.load(job.assetId))!;
    expect(await runUpload(persisted, deps)).toBe('paused_revoked');
    const after = (await store.load(job.assetId))!;
    expect(after.state).toBe('paused_revoked');
    expect(after.etags[1]).toBeDefined();
    expect(after.filePath).toBe(job.filePath);
  });

  it('EVM-011 AC2 a new session with the same deviceId resumes from the last confirmed part', async () => {
    const { server, store, deps } = setup();
    const job = mk();
    await expect(runUpload(job, { ...deps, checkpoint: killAt('afterPartSaved', 2) })).rejects.toBeInstanceOf(Killed);
    server.revoked = true;
    await runUpload((await store.load(job.assetId))!, deps);
    server.revoked = false; // user logged in again on the same device
    const putsBefore = server.putLog.length;
    expect(await runUpload((await store.load(job.assetId))!, deps)).toBe('uploaded');
    expect(server.putLog.slice(putsBefore).map((p) => p.n)).toEqual([3, 4]);
  });

  it('EVM-011 AC2 a different deviceId gets id_conflict (a session is continued only by its creator)', async () => {
    const { deps } = setup();
    const job = mk('dev-1');
    await runUpload(job, deps);
    const other = { ...mk('dev-2'), assetId: job.assetId };
    expect(await runUpload(other, deps)).toBe('id_conflict');
  });
});

describe('EVM-011 AC2 integrity and local deletion', () => {
  it('EVM-011 AC3 marks verified only for a matching SHA-256 and refuses a mismatch', async () => {
    const { store, deps } = setup();
    const job = mk();
    await runUpload(job, deps);
    const uploaded = (await store.load(job.assetId))!;
    await expect(markVerified(store, uploaded, 'b'.repeat(64))).rejects.toThrow(/integrity/);
    expect((await markVerified(store, uploaded, job.sha256)).state).toBe('verified');
  });

  it('EVM-011 AC2 never deletes the local file before verification; deletes it afterwards', async () => {
    const { store, deps } = setup();
    const job = mk();
    await runUpload(job, deps);
    const removed: string[] = [];
    const remove = async (p: string) => void removed.push(p);
    const uploaded = (await store.load(job.assetId))!;
    await expect(deleteLocalIfVerified(store, uploaded, remove)).rejects.toThrow(/refusing/);
    expect(removed).toEqual([]);
    const verified = await markVerified(store, uploaded, job.sha256);
    const done = await deleteLocalIfVerified(store, verified, remove);
    expect(done.state).toBe('local_deleted');
    expect(removed).toEqual([job.filePath]);
  });
});
