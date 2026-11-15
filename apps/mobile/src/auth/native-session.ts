/**
 * The native owner of the tokens as the session owner sees it (EVM-130, ADR-0020a). Where the module does not exist (Jest, a platform
 * without it) every call answers "unavailable" — fail closed: no sign-in is possible, because JavaScript never stores a token itself.
 */
import type { EviaUploadModule } from '../../modules/evia-upload/src';
import type { NativeSession } from './ports';

const NOBODY = { remove: (): void => undefined };

export const UNAVAILABLE_SESSION: NativeSession = {
  stageLogin: () => Promise.resolve('unavailable'),
  commitStaged: () => Promise.resolve('unavailable'),
  abandonStaged: () => Promise.resolve('unavailable'),
  accessToken: () => Promise.resolve({ status: 'unavailable' }),
  reportApiRevoked: () => Promise.resolve(false),
  reportDeviceWipeRequired: () => Promise.resolve(false),
  reportUpdateRequired: () => Promise.resolve(false),
  signOut: () => Promise.resolve(false),
  flushPendingRevocations: () => Promise.resolve(false),
  sessionState: () => Promise.resolve({ state: 'unavailable', ownerId: null }),
  clearWipeMarkerAfterLogin: () => Promise.resolve(false),
  lastContact: () => Promise.resolve(null),
  addListener: () => NOBODY,
};

export const nativeSessionOf = (module: EviaUploadModule | null): NativeSession => module ?? UNAVAILABLE_SESSION;
