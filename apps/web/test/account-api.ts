import type { Account, CurrentSession } from '@evia/contracts';
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { resetServerClock } from '../src/session/server-clock.ts';
import { resetStepUp } from '../src/session/step-up.ts';
import { ACTIVE_SESSION, json, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi } from './render.tsx';

/** Shared fixture of the tests of W-15 "Konto" (EVM-028): synthetic data only. */
export const ACCOUNT_ROUTE = 'GET /api/v1/account';
export const PATCH_ACCOUNT = 'PATCH /api/v1/account';
export const REAUTH = 'POST /api/v1/account/reauthentication';
export const CHANGE_PASSWORD = 'POST /api/v1/account/password';
export const PASSKEY_OPTIONS_ROUTE = 'POST /api/v1/account/passkeys/registration-options';
export const REGISTER_PASSKEY = 'POST /api/v1/account/passkeys';
export const TOTP_START = 'POST /api/v1/account/totp/enrolment';
export const TOTP_CONFIRM = 'POST /api/v1/account/totp/confirm';
export const REMOVE_TOTP = 'DELETE /api/v1/account/totp';
export const CODES_ROUTE = 'POST /api/v1/account/recovery-codes';
export const SESSIONS = 'GET /api/v1/account/sessions';
export const END_OTHERS = 'DELETE /api/v1/account/sessions';
export const DEVICES = 'GET /api/v1/account/devices';
export const STEP_UP = 'POST /api/v1/auth/step-up';
export const STEP_UP_OPTIONS = 'POST /api/v1/auth/step-up/options';

export const PASSKEY_ID = '22222222-2222-4222-8222-222222222222';
export const SECOND_PASSKEY_ID = '33333333-3333-4333-8333-333333333333';
export const SESSION_ID = '44444444-4444-4444-8444-444444444444';
export const OTHER_SESSION_ID = '55555555-5555-4555-8555-555555555555';

export const EDITOR_SESSION: CurrentSession = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'editor' } };

export const LAPTOP = {
  id: PASSKEY_ID,
  name: 'Laptop w biurze',
  createdAt: '2026-10-03T10:00:00Z',
  deviceType: 'multi_device',
  backedUp: true,
} as const;
export const PHONE = {
  id: SECOND_PASSKEY_ID,
  name: 'Telefon',
  createdAt: '2026-10-04T10:00:00Z',
  deviceType: 'multi_device',
  backedUp: true,
} as const;

/** An Editor with one passkey, a code of the app and seven recovery codes left. */
export const EDITOR_ACCOUNT: Account = {
  displayName: 'Anna Testowa',
  email: 'anna.testowa@example.com',
  role: 'editor',
  secondStep: {
    passkeys: [LAPTOP],
    totp: { addedAt: '2026-10-03T11:00:00Z' },
    recoveryCodes: { remaining: 7, generatedAt: '2026-10-03T12:00:00Z' },
  },
};

export const ADMINISTRATOR_ACCOUNT: Account = {
  ...EDITOR_ACCOUNT,
  role: 'administrator',
  secondStep: { passkeys: [LAPTOP, PHONE], totp: null, recoveryCodes: { remaining: 10, generatedAt: '2026-10-03T12:00:00Z' } },
};

export const NEW_CODES = [
  'ABCDEFGHIJKLMNOPQRST',
  'ABCDEFGHIJKLMNOPQRS2',
  'ABCDEFGHIJKLMNOPQRS3',
  'ABCDEFGHIJKLMNOPQRS4',
  'ABCDEFGHIJKLMNOPQRS5',
  'ABCDEFGHIJKLMNOPQRS6',
  'ABCDEFGHIJKLMNOPQRS7',
  'ABCDEFGHIJKLMNOPQR22',
  'ABCDEFGHIJKLMNOPQR23',
  'ABCDEFGHIJKLMNOPQR24',
];

/** A fake API with an active session of the role of `account` and the account itself; the tests add or replace routes. */
export function accountApi(account: Account, routes: Record<string, Handler> = {}) {
  const session =
    account.role === 'administrator' ? ACTIVE_SESSION : { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: account.role } };
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    [ACCOUNT_ROUTE]: () => json(200, account),
    // EVM-095: the card "Urządzenia" reads the own phones (none by default)
    [DEVICES]: () => json(200, { items: [] }, { 'Cache-Control': 'no-store' }),
    ...routes,
  });
}

/** The offline state of the browser (the banner and the disabled buttons follow the event). */
export function goOffline(): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  act(() => {
    globalThis.dispatchEvent(new Event('offline'));
  });
}

export function resetAccountTest(): void {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'credentials');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  resetStepUp();
  resetServerClock();
}

/** WebAuthn of the browser as the panel uses it (the native JSON helpers), with a ceremony the test controls. */
export const CREDENTIAL = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'Y2xpZW50', attestationObject: 'YXR0ZXN0' },
};
export const ASSERTION = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'Y2xpZW50', authenticatorData: 'YXV0aA', signature: 'c2ln' },
};
export const REGISTRATION_OPTIONS = {
  rp: { id: 'localhost', name: 'EVia Manager' },
  user: { id: 'dXNlci1oYW5kbGU', name: 'anna.testowa@example.com', displayName: 'Anna Testowa' },
  challenge: 'Y2hhbGxlbmdl',
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  authenticatorSelection: { userVerification: 'required' },
  attestation: 'none',
};
export const ASSERTION_OPTIONS = {
  challenge: 'Y2hhbGxlbmdl',
  rpId: 'localhost',
  userVerification: 'required',
  allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
};

export class FakePublicKeyCredential {
  static readonly parseCreationOptionsFromJSON = vi.fn((options: object) => ({ ...options, parsed: true }));
  static readonly parseRequestOptionsFromJSON = vi.fn((options: object) => ({ ...options, parsed: true }));
  readonly #json: object;
  constructor(json: object) {
    this.#json = json;
  }
  toJSON() {
    return this.#json;
  }
}

export function stubWebAuthn({
  create = () => Promise.resolve(new FakePublicKeyCredential(CREDENTIAL)),
  get = () => Promise.resolve(new FakePublicKeyCredential(ASSERTION)),
}: { create?: () => Promise<unknown>; get?: () => Promise<unknown> } = {}) {
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
  const spies = { create: vi.fn(create), get: vi.fn(get) };
  Object.defineProperty(navigator, 'credentials', { value: spies, configurable: true });
  return spies;
}
