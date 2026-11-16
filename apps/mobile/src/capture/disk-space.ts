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

/** Before a film starts: below 200 MB the "Film" chip is off (the block of 100 MB + a reserve of 50 MB + about a minute of film; EVM-110 AC2). */
export const VIDEO_BLOCK_BELOW_BYTES = 200 * MB;
/** A film that runs stops and is saved when the free space falls below this (the same 100 MB as the block of a picture). */
export const VIDEO_STOP_BELOW_BYTES = BLOCK_BELOW_BYTES;
/** The safety limit of the size of a film (a phone that ignores the bitrate cannot record more); every film stays below the scan threshold of 2 GB. */
export const VIDEO_SAFETY_BYTES = 500_000_000;
/** What stays free when the size limit is counted from the free space. */
export const VIDEO_RESERVE_BYTES = 150 * MB;
/** The library takes `maxFileSize` as a 32-bit integer. */
export const INT_MAX = 2 ** 31 - 1;

const usable = (freeBytes: number | null): freeBytes is number => freeBytes !== null && Number.isFinite(freeBytes) && freeBytes >= 0;

/** `blocked` below [VIDEO_BLOCK_BELOW_BYTES]; an unknown or nonsensical reading is `ok` (the native import and the engine check again). */
export function videoDiskLevel(freeBytes: number | null): 'ok' | 'blocked' {
  return usable(freeBytes) && freeBytes < VIDEO_BLOCK_BELOW_BYTES ? 'blocked' : 'ok';
}

/**
 * `maxFileSize` of the recording, counted at the start: the smaller of the safety limit and the free space minus the reserve, at least 1 (0 means "no limit"
 * to the library) and never above a 32-bit integer.
 */
export function videoSizeLimit(freeBytes: number | null): number {
  const room = usable(freeBytes) ? freeBytes - VIDEO_RESERVE_BYTES : VIDEO_SAFETY_BYTES;
  return Math.min(INT_MAX, Math.max(1, Math.floor(Math.min(VIDEO_SAFETY_BYTES, room))));
}
