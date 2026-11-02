/**
 * Composition of the sign-in and the session (EVM-100; architect 6): the only place where the HTTP adapter, the secure store, the local
 * store and the session owner meet. Screens get `SessionPorts` and never import the adapters (dependency-cruiser).
 */
import { Linking } from 'react-native';
import { createHttpAuthClient } from './api/auth-client';
import { clientHeaders } from './api/health';
import { systemClock } from './auth/clock';
import type { AuthClient } from './auth/ports';
import { MobileSessionOwner } from './auth/session-owner';
import { readRuntimeConfig, type RuntimeConfig } from './config';
import { readDeviceInfo } from './device/device-info';
import { DeviceGuard } from './device-guard/device-guard';
import {
  createAuthenticator,
  createBootClock,
  createContactClock,
  createDeviceLock,
  createPatchSource,
  reactNativeAppState,
} from './device-guard/native';
import { overrideAuthenticator, overrideBootClock, overrideLock, overrideSessionClock } from './device-guard/overrides';
import { createSensitiveClipboard } from './clipboard/clipboard';
import { deviceOverrides } from './e2e-hooks';
import { i18next } from './i18n';
import { logDiagnostic } from './logging/log';
import { CompanyDataWipe, type WipeConfirmClient } from './wipe/company-wipe';
import type { SessionPorts } from './screens/SessionRoot';
import { tokenStore } from './secure-store';
import { localData, randomSource } from './storage';
import { createHttpSyncTransport } from './sync/http-transport';
import { SyncHost } from './sync/sync-host';
import { SyncService } from './sync/sync-service';

/** Fixed path of the password reset of the panel (apps/web `LOGIN_RESET_PATH`); no part of it comes from input (security W9). */
export const PASSWORD_RESET_PATH = '/login/reset';

/** Without a valid API address every call is "unavailable" (the sign-in shows the generic error, nothing is sent). */
export const NO_API: AuthClient & WipeConfirmClient = {
  confirmWipe: () => Promise.resolve({ kind: 'unavailable' }),
  login: () => Promise.resolve({ kind: 'unavailable' }),
  loginTotp: () => Promise.resolve({ kind: 'unavailable' }),
  refresh: () => Promise.resolve({ kind: 'unavailable' }),
  logout: () => Promise.resolve({ kind: 'unavailable' }),
};

/** Origin (scheme + host + port) of a validated base address. */
export function originOf(baseUrl: string): string {
  return /^[a-z]+:\/\/[^/]+/i.exec(baseUrl)?.[0] ?? baseUrl;
}

/** Without a valid API address nothing is sent: every call is a network failure (the sign-in says the same). */
const NO_SYNC_TRANSPORT = {
  sendBatch: () => Promise.resolve({ kind: 'network' as const }),
  getChanges: () => Promise.resolve({ kind: 'network' as const }),
  getWorkOrderSnapshot: () => Promise.resolve({ kind: 'network' as const }),
  getClientConfig: () => Promise.resolve({ kind: 'network' as const }),
};

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
  // the e2e variant may move the clocks and the screen-lock answer (src/e2e-hooks); in every other bundle `deviceOverrides` is null
  const clock = overrideSessionClock(systemClock, deviceOverrides);
  const deviceLock = overrideLock(createDeviceLock(), deviceOverrides);
  const companyWipe = new CompanyDataWipe({ host, client, now: Date.now, diagnostics: logDiagnostic });
  // the 7-day rule reads the boot clock (counts the phone's sleep), shifted like the session clock in the e2e variant (EVM-101 AC2)
  const contactClock = overrideSessionClock(createContactClock(), deviceOverrides);
  const owner = new MobileSessionOwner({ client, tokens: tokenStore, host, wipe: companyWipe, clock, contactClock });
  const guard = new DeviceGuard({
    deviceLock,
    boot: overrideBootClock(createBootClock(), deviceOverrides),
    authenticator: overrideAuthenticator(
      createAuthenticator(() => ({ title: i18next.t('lock.prompt') })),
      deviceOverrides,
    ),
    appState: reactNativeAppState,
    patch: createPatchSource(),
    contact: () => owner.contactStatus(),
    now: Date.now,
    diagnostics: logDiagnostic,
  });
  const clipboard = createSensitiveClipboard();
  // EVM-107: one synchronization service per session; the owner stops it (and the clipboard copy goes) BEFORE it removes the replica
  const sync = new SyncHost(
    (store, hooks) =>
      new SyncService({
        store,
        owner,
        contactVisible: async () => (await owner.contactStatus())?.status.visible === true,
        createTransport: ({ signal, pendingItems }) =>
          config === null
            ? NO_SYNC_TRANSPORT
            : createHttpSyncTransport({
                baseUrl: config.apiBaseUrl,
                allowLocalHttp: config.buildVariant === 'e2e',
                fetch: (url, init) => owner.authorizedFetch(url, init),
                headers: clientHeaders(config.platform, config.appVersion),
                pendingItems,
                signal,
              }),
        clock: { now: Date.now },
        monotonic: contactClock,
        random: randomSource(),
        isOnline: hooks.isOnline,
        onPause: hooks.onPause,
        diagnostics: logDiagnostic,
      }),
    () => owner.syncStore(),
  );
  owner.onBeforeSessionEnd(() => {
    sync.stop();
    clipboard.clear();
  });
  // a wipe in progress hides the data; a finished one is confirmed to the server at every start and return to the foreground
  companyWipe.onPhase((phase) => {
    guard.setWiping(phase !== 'idle');
    if (phase !== 'idle') clipboard.clear();
  });
  // the lock and the hidden-data mode take the copy of a rejected entry off the clipboard (security S1)
  guard.subscribe(() => {
    const state = guard.getSnapshot();
    if (state.locked || state.hidden !== null) clipboard.clear();
  });
  guard.onForeground(() => {
    void companyWipe.resume();
    sync.foreground();
  });
  void companyWipe.resume();
  return {
    owner,
    wipe: companyWipe,
    guard,
    companyWipe,
    screenLockOk: () => deviceLock.isDeviceSecure().catch(() => false),
    openAddTarget: () => undefined,
    sync,
    copyToClipboard: (text) => clipboard.copy(text),
    unsentBeforeSignIn: () => host.unsentItemCountBeforeSignIn(),
    openForgotPassword: () => {
      if (config !== null) void Linking.openURL(`${originOf(config.apiBaseUrl)}${PASSWORD_RESET_PATH}`).catch(() => undefined);
    },
    openHelp: () => undefined,
    appVersion: config?.appVersion ?? 'unknown',
  };
}

let ports: SessionPorts | undefined;

/** The single session of the process. */
export function sessionPorts(): SessionPorts {
  ports ??= createSessionPorts();
  return ports;
}
