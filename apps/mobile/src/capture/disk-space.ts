/**
 * Free space on the phone for the camera (EVM-108 AC4). The thresholds are ONE constant pair (decision of the Tech Lead, 2026-11-15):
 * below `WARN_BELOW_BYTES` the camera warns ("Mało miejsca w telefonie: 1,2 GB." — the real value, formatted by the screen), below
 * `BLOCK_BELOW_BYTES` a picture is not taken at all (nothing is written, the queue and the counter stay as they were).
 */
import { Paths } from 'expo-file-system';

const MB = 1024 * 1024;
export const WARN_BELOW_BYTES = 2 * 1024 * MB;
export const BLOCK_BELOW_BYTES = 100 * MB;

export type DiskLevel = 'ok' | 'low' | 'blocked';

/** The port of the capture: free bytes of the app's storage, or `null` when unknown. */
export interface DiskSpace {
  freeBytes(): number | null;
}

/**
 * An unknown or nonsensical reading (`null`, NaN, negative, infinite) counts as `ok`: the technician is not stopped by a reading that failed,
 * and the native import checks the space again before it writes (`no_space`).
 */
export function diskLevel(freeBytes: number | null): DiskLevel {
  if (freeBytes === null || !Number.isFinite(freeBytes) || freeBytes < 0) return 'ok';
  if (freeBytes < BLOCK_BELOW_BYTES) return 'blocked';
  return freeBytes < WARN_BELOW_BYTES ? 'low' : 'ok';
}

export const expoDiskSpace: DiskSpace = {
  freeBytes: () => {
    try {
      return Paths.availableDiskSpace;
    } catch {
      return null;
    }
  },
};
