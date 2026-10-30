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

/** Codes of the local store (EVM-093): only allow-listed shapes pass (a fixed name plus a code), never a number, path or key. */
const CODE = /^[a-z_]{1,40}$/;

export function logDiagnostic(diagnostic: StorageDiagnostic): void {
  const detail =
    diagnostic.event === 'db-open-failed' ? diagnostic.code : diagnostic.event === 'keystore-hardware' ? diagnostic.level : diagnostic.step;
  const safe = CODE.test(detail) ? detail : 'invalid';
  // eslint-disable-next-line no-console -- see logWarning; development builds only
  if (__DEV__) console.warn(`[evia] ${diagnostic.event} ${safe}`);
}
