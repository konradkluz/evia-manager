/**
 * The rules of the deletion of a medium or a document and of the erasure of its files (EVM-051; SR-PRIV-03, SR-DATA-08). Pure.
 */
import { businessDate } from '../../../platform/clock/business-date.ts';
import type { FileState } from './scan-outcome.ts';

/** The shape of the marker that replaces the title of a document whose files were erased (the date is the calendar day in `Europe/Warsaw`). */
export const ERASURE_MARKER_PATTERN = /^Plik usunięty przez administratora [0-9]{2}\.[0-9]{2}\.[0-9]{4}\.$/;

/** @param instant the moment of the erasure (from the injected clock) */
export function erasureMarker(instant: Date): string {
  const [year, month, day] = businessDate(instant).split('-');
  return `Plik usunięty przez administratora ${day}.${month}.${year}.`;
}

/** A file a worker (the scan, the derivatives) may be holding right now: the erasure waits for it (`409 file_processing`) instead of racing it. */
export const isBeingProcessed = (state: FileState): boolean => state === 'uploaded' || state === 'scanning' || state === 'processing';

/** How long a client waits before it asks again when the file is being processed (seconds). */
export const FILE_PROCESSING_RETRY_SECONDS = 30;
