import { createHealthClient } from '../api/health';
import { readRuntimeConfig } from '../config';
import { logWarning } from '../logging/log';
import { deriveStartupState } from './state';
import type { StartupState } from './state';

export type StartupChecker = () => Promise<StartupState>;

/** The real check: health and minimum version of the API from the configuration of the build. Never throws. */
export function createStartupChecker(): StartupChecker {
  return async () => {
    const config = readRuntimeConfig();
    if (config === null) {
      logWarning('api-config-invalid');
      return { kind: 'serverUnavailable', problem: 'invalid' };
    }
    const client = createHealthClient({ baseUrl: config.apiBaseUrl, platform: config.platform, appVersion: config.appVersion });
    return deriveStartupState(await client.fetchHealth(), config);
  };
}
