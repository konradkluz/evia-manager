/**
 * Composition of the sign-in and the session (EVM-100; architect 6): the only place where the HTTP adapter, the secure store, the local
 * store and the session owner meet. Screens get `SessionPorts` and never import the adapters (dependency-cruiser).
 */
import { Linking } from 'react-native';
import { createHttpAuthClient } from './api/auth-client';
import { systemClock } from './auth/clock';
import type { AuthClient, WipeSignal } from './auth/ports';
import { MobileSessionOwner } from './auth/session-owner';
import { readRuntimeConfig, type RuntimeConfig } from './config';
import { readDeviceInfo } from './device/device-info';
import type { SessionPorts } from './screens/SessionRoot';
import { tokenStore } from './secure-store';
import { localData } from './storage';

/** Fixed path of the password reset of the panel (apps/web `LOGIN_RESET_PATH`); no part of it comes from input (security W9). */
export const PASSWORD_RESET_PATH = '/login/reset';

/** Without a valid API address every call is "unavailable" (the sign-in shows the generic error, nothing is sent). */
const NO_API: AuthClient = {
  login: () => Promise.resolve({ kind: 'unavailable' }),
  loginTotp: () => Promise.resolve({ kind: 'unavailable' }),
  refresh: () => Promise.resolve({ kind: 'unavailable' }),
  logout: () => Promise.resolve({ kind: 'unavailable' }),
};

/** Origin (scheme + host + port) of a validated base address. */
export function originOf(baseUrl: string): string {
  return /^[a-z]+:\/\/[^/]+/i.exec(baseUrl)?.[0] ?? baseUrl;
}

/**
 * Stand-ins until their stories: the wipe of EVM-101 (the signal is the port; the wipe itself is not part of EVM-100), M-11 of
 * EVM-102 ("Pomoc").
 */
const pendingWipe: WipeSignal = { wipeRequired: () => undefined };

export function createSessionPorts(config: RuntimeConfig | null = readRuntimeConfig()): SessionPorts {
  const host = localData();
  const client =
    config === null
      ? NO_API
      : createHttpAuthClient({
          baseUrl: config.apiBaseUrl,
          allowLocalHttp: config.buildVariant === 'e2e',
          platform: config.platform,
          appVersion: config.appVersion,
          device: () => readDeviceInfo(),
          installationProof: () => host.installationProof(),
        });
  const owner = new MobileSessionOwner({ client, tokens: tokenStore, host, wipe: pendingWipe, clock: systemClock });
  return {
    owner,
    wipe: pendingWipe,
    unsentBeforeSignIn: () => host.unsentItemCountBeforeSignIn(),
    openForgotPassword: () => {
      if (config !== null) void Linking.openURL(`${originOf(config.apiBaseUrl)}${PASSWORD_RESET_PATH}`).catch(() => undefined);
    },
    openHelp: () => undefined,
    requestCompanyDataWipe: () => undefined,
    appVersion: config?.appVersion ?? 'unknown',
  };
}

let ports: SessionPorts | undefined;

/** The single session of the process. */
export function sessionPorts(): SessionPorts {
  ports ??= createSessionPorts();
  return ports;
}
