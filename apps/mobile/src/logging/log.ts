/**
 * The only logger of the app (SR-LOG-08, SR-MOB-10; MASVS-STORAGE-2): it accepts a fixed event name, never free text, so an
 * address, a response body or personal data cannot get into a log. Silent in release builds.
 */
export type LogEvent = 'app-version-invalid' | 'min-version-invalid' | 'api-config-invalid';

export function logWarning(event: LogEvent): void {
  // eslint-disable-next-line no-console -- the single sanctioned console call; development builds only
  if (__DEV__) console.warn(`[evia] ${event}`);
}
