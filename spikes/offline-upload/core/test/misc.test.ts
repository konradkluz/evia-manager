import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256Bytes, sha256File } from '../src/hash.ts';
import { FileStore, MemoryStore } from '../src/store.ts';
import { emptyMetrics, type UploadJob } from '../src/types.ts';
import { uuidv7 } from '../src/uuid.ts';

describe('EVM-011 AC1 identifiers, hashing and stores', () => {
  it('EVM-011 AC1 uuidv7 is version 7, variant 10xx and time-ordered', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(uuidv7()).not.toBe(uuidv7());
  });

  it('EVM-011 AC3 streams SHA-256 of a file (known vector for "abc")', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evm011-'));
    try {
      const f = join(dir, 'abc.bin');
      await writeFile(f, 'abc');
      const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
      expect(await sha256File(f)).toBe(expected);
      expect(sha256Bytes(new TextEncoder().encode('abc'))).toBe(expected);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('EVM-011 AC1 the file store persists jobs across instances (outbox survives a restart)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evm011-'));
    try {
      const path = join(dir, 'sub', 'jobs.json');
      const job: UploadJob = {
        assetId: 'x',
        deviceId: 'd',
        filePath: '/p',
        size: 1,
        sha256: 'h',
        contentType: 'image/jpeg',
        state: 'pending',
        etags: { 1: '"e"' },
        metrics: emptyMetrics(),
      };
      await new FileStore(path).save(job);
      expect(await new FileStore(path).load('x')).toEqual(job);
      expect(await new FileStore(path).load('missing')).toBeUndefined();
      const mem = new MemoryStore();
      await mem.save(job);
      expect(await mem.load('x')).toEqual(job);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
