/**
 * The verdict on a scanned file (ADR-0009; EVM-044 AC2, AC3, AC5; SR-FILE-05, SR-CRYPTO-05): ONE pass over the pinned bytes yields the
 * scanner verdict, the SHA-256 and the type; this function orders them. The order is a decision of the story: malware (quarantine) beats
 * a damaged transfer (failed, can be retried), which beats a wrong type (quarantine); only when all three agree is the file `clean`.
 */
export type FileState = 'pending_upload' | 'uploaded' | 'scanning' | 'clean' | 'processing' | 'ready' | 'quarantined' | 'failed';
export type ReasonCode = 'checksum_mismatch' | 'processing_error' | 'type_mismatch' | 'malware_detected' | 'abandoned';

export type ScanOutcome =
  | { readonly state: 'clean'; readonly reason: null }
  | { readonly state: 'quarantined'; readonly reason: 'malware_detected' | 'type_mismatch' }
  | { readonly state: 'failed'; readonly reason: 'checksum_mismatch' };

export interface ScanFindings {
  readonly infected: boolean;
  readonly checksumMatches: boolean;
  readonly typeMatches: boolean;
}

export function decideOutcome(findings: ScanFindings): ScanOutcome {
  if (findings.infected) return { state: 'quarantined', reason: 'malware_detected' };
  if (!findings.checksumMatches) return { state: 'failed', reason: 'checksum_mismatch' };
  if (!findings.typeMatches) return { state: 'quarantined', reason: 'type_mismatch' };
  return { state: 'clean', reason: null };
}

/** Files nobody may open: every state but `clean` and `ready` (domain-model.md, invariant of `StoredFile`). */
export const isDownloadable = (state: FileState): boolean => state === 'clean' || state === 'ready';
