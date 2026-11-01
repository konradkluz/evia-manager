/**
 * The only logger of the app (SR-LOG-08, SR-MOB-10; MASVS-STORAGE-2): it accepts a fixed event name, never free text, so an
 * address, a response body or personal data cannot get into a log. Silent in release builds.
 */
import type { StorageDiagnostic } from '../storage/ports';

export type LogEvent = 'app-version-invalid' | 'min-version-invalid' | 'api-config-invalid';

export function logWarning(event: LogEvent): void {
  // eslint-disable-next-line no-console -- the single sanctioned console call; development builds only
  if (__DEV__) console.warn(`[evia] ${event}`);
}

function detailOf(diagnostic: StorageDiagnostic | GuardDiagnostic | SyncLogDiagnostic): string {
  switch (diagnostic.event) {
    case 'db-open-failed':
      return diagnostic.code;
    case 'keystore-hardware':
      return diagnostic.level;
    case 'wipe-step-failed':
      return diagnostic.step;
    case 'wipe-confirmation':
    case 'app-lock':
    case 'patch-level':
      return diagnostic.outcome;
    case 'hidden-mode':
      return diagnostic.reason;
    case 'sync-failure':
      return diagnostic.kind;
    case 'sync-attention':
      return diagnostic.code;
  }
}

/** Codes of the local store (EVM-093): only allow-listed shapes pass (a fixed name plus a code), never a number, path or key. */
const CODE = /^[a-z_]{1,40}$/;

/**
 * Events of the synchronization (EVM-107; SR-LOG-08, security S6): a failure kind of a closed list and the code of a rejection - never
 * an id of a work order or a mutation, a content, an address or a message of the server.
 */
export type SyncLogDiagnostic =
  | { readonly event: 'sync-failure'; readonly kind: 'push' | 'pull' | 'rate_limited' | 'resync' }
  | { readonly event: 'sync-attention'; readonly code: string };

/** Events of the device controls (EVM-101; SR-LOG-08, SR-MOB-12): codes of a fixed dictionary, never an id, a secret or a content. */
export type GuardDiagnostic =
  | { readonly event: 'hidden-mode'; readonly reason: string }
  | { readonly event: 'app-lock'; readonly outcome: string }
  | { readonly event: 'patch-level'; readonly outcome: string };

export function logDiagnostic(diagnostic: StorageDiagnostic | GuardDiagnostic | SyncLogDiagnostic): void {
  const detail = detailOf(diagnostic);
  const safe = CODE.test(detail) ? detail : 'invalid';
  // eslint-disable-next-line no-console -- see logWarning; development builds only
  if (__DEV__) console.warn(`[evia] ${diagnostic.event} ${safe}`);
}
