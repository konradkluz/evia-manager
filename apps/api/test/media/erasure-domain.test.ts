import { describe, expect, it } from 'vitest';
import {
  ERASURE_MARKER_PATTERN,
  FILE_PROCESSING_RETRY_SECONDS,
  erasureMarker,
  isBeingProcessed,
} from '../../src/modules/media/domain/erasure.ts';
import type { FileState } from '../../src/modules/media/domain/scan-outcome.ts';
import { InMemoryObjectStorage } from '../../src/platform/object-storage/in-memory-object-storage.ts';
import { S3ObjectStorage } from '../../src/platform/object-storage/s3-object-storage.ts';

describe('EVM-051 AC2 the marker of an erased file (SR-PRIV-03)', () => {
  it('EVM-051 AC2 the marker is "Plik usunięty przez administratora DD.MM.RRRR." with the day in Europe/Warsaw', () => {
    expect(erasureMarker(new Date('2026-10-03T10:00:00.000Z'))).toBe('Plik usunięty przez administratora 03.10.2026.');
    // 23:30 UTC on the 3rd is already the 4th in Warsaw (CEST)
    expect(erasureMarker(new Date('2026-10-03T23:30:00.000Z'))).toBe('Plik usunięty przez administratora 04.10.2026.');
    expect(ERASURE_MARKER_PATTERN.test(erasureMarker(new Date('2026-12-31T23:30:00.000Z')))).toBe(true);
    expect(ERASURE_MARKER_PATTERN.test('Plik usunięty przez administratora 3.10.2026.')).toBe(false);
  });
});

describe('EVM-051 AC7 the erasure waits for a file a worker holds', () => {
  it('EVM-051 AC7 only uploaded, scanning and processing are busy; every other state may be erased', () => {
    const busy: FileState[] = ['uploaded', 'scanning', 'processing'];
    const rest: FileState[] = ['pending_upload', 'clean', 'ready', 'quarantined', 'failed'];
    for (const state of busy) expect(isBeingProcessed(state), state).toBe(true);
    for (const state of rest) expect(isBeingProcessed(state), state).toBe(false);
    expect(FILE_PROCESSING_RETRY_SECONDS).toBeGreaterThan(0);
  });
});

describe('EVM-051 AC5 (SR-FILE-11) the clients get signed addresses only', () => {
  it('EVM-051 AC5 the only presigning operations of the port are the signed GET and the signed PUT of a part - there is no signed listing', () => {
    for (const adapter of [S3ObjectStorage.prototype, InMemoryObjectStorage.prototype]) {
      const presigning = Object.getOwnPropertyNames(adapter).filter((name) => name.startsWith('presign'));
      expect(presigning.sort()).toEqual(['presignGet', 'presignUploadPart']);
    }
  });

  it('EVM-051 AC5 the listing of the in-memory storage pages in key order, leaves out the deleted objects and reports the time of writing', async () => {
    let now = new Date('2026-10-03T10:00:00.000Z');
    const storage = new InMemoryObjectStorage(() => now);
    for (const key of ['media/b', 'media/a', 'media/c', 'documents/x']) storage.putObject(key, Buffer.from('x'));
    now = new Date('2026-10-03T11:00:00.000Z');
    await storage.deleteObject('media/b');
    const first = await storage.listObjects('media/', 1);
    expect(first.objects.map((object) => object.key)).toEqual(['media/a']);
    expect(first.objects[0]?.modifiedAt).toEqual(new Date('2026-10-03T10:00:00.000Z'));
    const second = await storage.listObjects('media/', 1, first.nextToken);
    expect(second.objects.map((object) => object.key)).toEqual(['media/c']);
    expect(second.nextToken).toBeUndefined();
    storage.unavailable = true;
    await expect(storage.listObjects('media/', 10)).rejects.toMatchObject({ code: 'unavailable' });
  });
});
