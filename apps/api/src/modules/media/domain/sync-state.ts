/**
 * The state of the file of a medium as the PHONE sees it (EVM-131 AC4; ADR-0021 D4; SR-MOB-10, SR-FILE-05). A pure mapping: the phone deletes the original only after `clean`, and the
 * server gives `clean` only after the scan agreed (the checksum, the type and the antivirus), so every state before that - also `uploaded` and `scanning` - is `uploading`.
 * The reason is an allow-list: the reason of a quarantine (`malware_detected`, `type_mismatch`) and any reason that is not named here never reaches a phone - it is `null`.
 */
import type { FileState } from './scan-outcome.ts';

export type SyncFileState = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed' | 'clean' | 'quarantined';
export type SyncReasonCode = 'checksum_mismatch' | 'processing_error' | 'abandoned';

const STATES: Readonly<Record<FileState, SyncFileState>> = {
  pending_upload: 'pending',
  uploaded: 'uploading',
  scanning: 'uploading',
  clean: 'clean',
  processing: 'processing',
  ready: 'ready',
  quarantined: 'quarantined',
  failed: 'failed',
};

const FAILED_REASONS: ReadonlySet<string> = new Set<SyncReasonCode>(['checksum_mismatch', 'processing_error', 'abandoned']);

export interface SyncFileStatus {
  readonly fileState: SyncFileState;
  readonly fileStateReasonCode: SyncReasonCode | null;
}

/** @param state `null` - the medium has no file yet (created on the phone, the upload session is not open): `pending` */
export function syncFileStatus(state: FileState | null, reason: string | null): SyncFileStatus {
  if (state === null) return { fileState: 'pending', fileStateReasonCode: null };
  const fileState = STATES[state];
  const allowed = fileState === 'failed' && reason !== null && FAILED_REASONS.has(reason);
  return { fileState, fileStateReasonCode: allowed ? (reason as SyncReasonCode) : null };
}
