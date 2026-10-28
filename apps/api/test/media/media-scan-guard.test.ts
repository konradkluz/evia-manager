import { describe, expect, it } from 'vitest';
import { MediaScanService, type ScanDependencies } from '../../src/modules/media/application/media-scan.service.ts';

// The guard answers before anything touches the database, the clock or the logger.
const untouched = new Proxy({}, { get: () => assertUnused }) as unknown as ScanDependencies['db'];
const assertUnused = (): never => {
  throw new Error('must not be reached');
};
const deps = (storage: unknown, scanner: unknown): ScanDependencies =>
  ({ db: untouched, clock: untouched, events: untouched, logger: untouched, storage, scanner }) as unknown as ScanDependencies;

describe('EVM-044 AC3 a file is never scanned (and so never clean) without both the storage and the scanner', () => {
  it('EVM-044 AC3 scanFile refuses a direct call when the scanner is not configured', async () => {
    const service = new MediaScanService(deps({}, null));
    expect(service.enabled).toBe(false);
    await expect(service.scanFile('any')).resolves.toBe(false);
  });

  it('EVM-044 AC3 scanFile refuses a direct call when the storage is not configured', async () => {
    const service = new MediaScanService(deps(null, {}));
    expect(service.enabled).toBe(false);
    await expect(service.scanFile('any')).resolves.toBe(false);
  });
});
