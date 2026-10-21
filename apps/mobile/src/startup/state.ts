/**
 * Startup state of the app (EVM-009 AC2, AC3) and its pure derivation from the health answer.
 * Offline-first (ADR-0007): `checking` and every failure leave the app usable; only a minimum version CONFIRMED by the server
 * blocks, and it blocks work with the server — never the data already stored on the phone (the queue of M2 must survive it).
 */
import type { ClientPlatform, HealthResult } from '../api/health';
import { logWarning } from '../logging/log';
import { compareVersions, parseVersion } from './semver';

export type ServerProblem = 'timeout' | 'server' | 'invalid';

export type StartupState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'online' }
  /** The device has no connection to the server (the request failed before any answer): work continues locally. */
  | { readonly kind: 'offline' }
  /** There seems to be a network, but the server does not answer correctly (timeout, 5xx, a malformed answer). */
  | { readonly kind: 'serverUnavailable'; readonly problem: ServerProblem }
  /** The server confirmed that this app version is no longer supported. Blocks online work only, not the local data. */
  | { readonly kind: 'updateRequired'; readonly currentVersion: string; readonly requiredVersion: string };

export function deriveStartupState(
  result: HealthResult,
  { platform, appVersion }: { platform: ClientPlatform; appVersion: string },
): StartupState {
  switch (result.kind) {
    case 'network':
      return { kind: 'offline' };
    case 'timeout':
    case 'server':
    case 'invalid':
      return { kind: 'serverUnavailable', problem: result.kind };
    case 'ok': {
      const requiredVersion = result.minSupportedAppVersion[platform];
      const order = requiredVersion === undefined ? null : compareVersions(appVersion, requiredVersion);
      if (requiredVersion === undefined || order === null) {
        // Fail open: bad version data must not lock a technician out of the own offline data.
        logWarning(parseVersion(appVersion) === null ? 'app-version-invalid' : 'min-version-invalid');
        return { kind: 'online' };
      }
      return order < 0 ? { kind: 'updateRequired', currentVersion: appVersion, requiredVersion } : { kind: 'online' };
    }
  }
}
