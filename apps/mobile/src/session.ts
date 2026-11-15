/**
 * Composition of the sign-in and the session (EVM-100; architect 6): the only place where the HTTP adapter, the secure store, the local
 * store and the session owner meet. Screens get `SessionPorts` and never import the adapters (dependency-cruiser).
 */
import { createUuidV7 } from '@evia/sync-core';
import { Linking } from 'react-native';
import { loadEviaUpload, type EviaUploadModule } from '../modules/evia-upload/src';
import { createHttpAuthClient } from './api/auth-client';
import { clientHeaders } from './api/health';
import { systemClock } from './auth/clock';
import { nativeSessionOf } from './auth/native-session';
import type { AuthClient } from './auth/ports';
import { MobileSessionOwner } from './auth/session-owner';
import { readBuildNumber, readRuntimeConfig, type RuntimeConfig } from './config';
import { readContact } from './config/contact';
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
import { CameraRequests } from './capture/camera-requests';
import { expoDiskSpace } from './capture/disk-space';
import { MediaUploads } from './upload/media-uploads';
import { nativeUploadOf } from './upload/native-upload';
import { reconcileOnSyncChange } from './upload/reconcile-trigger';

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
  listWorkOrderTemplates: () => Promise.resolve({ kind: 'network' as const }),
};

let makeId: (() => string) | undefined;
/** The ids of the session: UUIDv7 from the CSPRNG of the storage module, never a non-cryptographic generator (SR-SYNC-03). */
const newId = (): string => (makeId ??= createUuidV7({ now: Date.now }, randomSource()))();
/** The queue of files of the session, for the e2e hook that adds a synthetic file (`src/e2e-hooks/panel.tsx`); screens use `ports.media`. */
let mediaUploads: MediaUploads | null = null;

export function createSessionPorts(
  config: RuntimeConfig | null = readRuntimeConfig(),
  /** The native module of the tokens and the upload (EVM-130); `null` where it does not exist (Jest): no sign-in, no upload. */
  module: EviaUploadModule | null = loadEviaUpload(),
): SessionPorts {
  const host = localData();
  const nativeSession = nativeSessionOf(module);
  const nativeUpload = nativeUploadOf(module);
  // the refresh token and the pending revocation of older versions are deleted at every start WITHOUT being read (EVM-130 AC3):
  // the user signs in once more, the queue and the local data stay
  void tokenStore.purgeLegacyTokens().catch(() => undefined);
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
  const owner = new MobileSessionOwner({ client, tokens: tokenStore, native: nativeSession, host, wipe: companyWipe, clock, contactClock });
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
  // EVM-130 AC5: the FIRST step of the wipe is one native call (marker → cancel the jobs → files → the token store); `false` = something
  // is left and the step is repeated (also at the next start) before anything else is deleted
  host.registerWipeStep(
    'native_uploads',
    async () => {
      if (!(await nativeUpload.wipeUploads())) throw new Error('native wipe unfinished');
    },
    { first: true },
  );
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
  // EVM-130: the files of the queue — armed after `applied`, confirmed by the replica, shown in the Queue
  const media = new MediaUploads({
    native: nativeUpload,
    store: () => owner.syncStore(),
    enqueue: (input) => sync.enqueue(input),
    now: Date.now,
    dataVisible: () => guard.getSnapshot().hidden === null,
    onNativeEvent: () => {
      void owner.mergeNativeContact();
    },
    // the camera (EVM-108): the free space of the phone and the ids of the session (UUIDv7, CSPRNG)
    capture: { disk: expoDiskSpace, newId },
  });
  media.start();
  mediaUploads = media;
  // a session starts, a cycle ends, something settles or the replica changes: the rows are reconciled again (single-flight)
  reconcileOnSyncChange(sync, media);
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
    // the module may have stopped the session in the background and made contacts; the files are armed and confirmed again
    void owner.reconcileNative();
    void owner.mergeNativeContact();
    void media.refresh();
  });
  void companyWipe.resume();
  return {
    owner,
    wipe: companyWipe,
    guard,
    companyWipe,
    screenLockOk: () => deviceLock.isDeviceSecure().catch(() => false),
    openAddTarget: () => undefined,
    // the ids of entries written on the phone: UUIDv7 from the CSPRNG of the storage module, never a non-cryptographic generator (SR-SYNC-03)
    newId,
    camera: new CameraRequests({ orders: () => sync.orderList(false) }),
    sync,
    media,
    copyToClipboard: (text) => clipboard.copy(text),
    unsentBeforeSignIn: () => host.unsentItemCountBeforeSignIn(),
    openForgotPassword: () => {
      if (config !== null) void Linking.openURL(`${originOf(config.apiBaseUrl)}${PASSWORD_RESET_PATH}`).catch(() => undefined);
    },
    // M-11 (EVM-102): the contact of the office comes from the build; `mailto:` / `tel:` open in the program of the phone, a refusal is shown
    privacyHelp: { build: readBuildNumber(), contact: readContact(), openUrl: (url) => Linking.openURL(url) },
    appVersion: config?.appVersion ?? 'unknown',
  };
}

/** The queue of files of the process (for the e2e hook only; `null` before the session ports exist). */
export function sessionMediaUploads(): Pick<MediaUploads, 'add'> | null {
  sessionPorts();
  return mediaUploads;
}

let ports: SessionPorts | undefined;

/** The single session of the process. */
export function sessionPorts(): SessionPorts {
  ports ??= createSessionPorts();
  return ports;
}
