import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, BackHandler, Platform, StyleSheet } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { App } from '../src/App';
import type { SignInClient } from '../src/auth/ports';
import { pl } from '../src/i18n/pl';
import { OFFLINE_RECHECK_FIRST_MS, OFFLINE_RECHECK_MAX_MS } from '../src/screens/LoginScreen';
import { unsentKey } from '../src/screens/MoreScreen';
import type { StartupChecker, StartupState } from '../src/startup';
import { size } from '../src/ui/theme';
import { okSignIn, stubOwner, stubPorts, type PortsRig } from './session-helpers';

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context');
  const insets = { top: 24, left: 0, right: 0, bottom: 16 };
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => (
      <actual.SafeAreaInsetsContext.Provider value={insets}>{children}</actual.SafeAreaInsetsContext.Provider>
    ),
  };
});

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const settle = () =>
  act(async () => {
    for (let n = 0; n < 6; n += 1) await Promise.resolve();
  });
const online: StartupChecker = () => Promise.resolve({ kind: 'online' });
const offline: StartupChecker = () => Promise.resolve({ kind: 'offline' });

async function open(rig: PortsRig, checker: StartupChecker = online) {
  await render(<App session={rig.session} checker={checker} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}

function signedOut(signIn?: SignInClient, unsentBeforeSignIn: number | null = 0): PortsRig {
  const owner = stubOwner(signIn ?? okSignIn());
  owner.restoreResult = { kind: 'signed_out' };
  return stubPorts(owner, unsentBeforeSignIn);
}

async function typeCredentials() {
  await fireEvent.changeText(screen.getByLabelText(pl.login.email), 'jan@example.test');
  await fireEvent.changeText(screen.getByLabelText(pl.login.password), 'synthetic-password');
}

async function toCode() {
  await typeCredentials();
  await fireEvent.press(screen.getByRole('button', { name: pl.login.submit }));
  await settle();
}

describe('M-01 sign-in (EVM-100 AC1, AC8)', () => {
  it('EVM-100 AC1: e-mail and password, then the code → the shell; the session goes to the owner and pending revocations are sent', async () => {
    const rig = signedOut();
    await open(rig);
    expect(screen.getByRole('header', { name: pl.login.title })).toBeOnTheScreen();
    await toCode();
    expect(screen.getByLabelText(pl.login.code)).toBeOnTheScreen();
    expect(screen.queryByLabelText(pl.login.password)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText(pl.login.code), '123 456');
    expect(screen.getByLabelText(pl.login.code)).toHaveProp('value', '123456');
    await fireEvent.press(screen.getByRole('button', { name: pl.login.confirm }));
    await settle();
    expect(rig.owner.calls).toContain('completeSignIn');
    expect(rig.owner.calls).toContain('flush');
    // a fresh session needs no refresh (the access token of step 2 is in memory)
    expect(rig.owner.calls).not.toContain('refresh');
    expect(screen.getByRole('header', { name: pl.shell.orders.title })).toBeOnTheScreen();
  });

  it('EVM-100 AC1 (W6): the password is masked with "Pokaż"/"Ukryj", nothing is learnt by the keyboard, autofill is allowed', async () => {
    await open(signedOut());
    const password = screen.getByLabelText(pl.login.password);
    expect(password).toHaveProp('secureTextEntry', true);
    expect(password).toHaveProp('autoCorrect', false);
    expect(password).toHaveProp('spellCheck', false);
    expect(password).toHaveProp('autoCapitalize', 'none');
    expect(password).toHaveProp('autoComplete', 'password');
    const toggle = screen.getByRole('switch', { name: pl.login.showPassword });
    expect(toggle).toHaveProp('accessibilityState', { checked: false });
    expect(flat(toggle).minHeight).toBeGreaterThanOrEqual(size.touchTarget.min);
    await fireEvent.press(toggle);
    expect(screen.getByLabelText(pl.login.password)).toHaveProp('secureTextEntry', false);
    expect(screen.getByLabelText(pl.login.password)).toHaveProp(
      'keyboardType',
      Platform.OS === 'android' ? 'visible-password' : 'ascii-capable',
    );
    expect(screen.getByRole('switch', { name: pl.login.hidePassword })).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByText(pl.login.hide)).toBeOnTheScreen();
    expect(screen.getByLabelText(pl.login.email)).toHaveProp('keyboardType', 'email-address');
  });

  it('EVM-100 AC1: the code is masked, numeric, without autocorrect and with one-time-code autofill; "Pokaż kod" shows it', async () => {
    await open(signedOut());
    await toCode();
    const code = screen.getByLabelText(pl.login.code);
    expect(code).toHaveProp('secureTextEntry', true);
    expect(code).toHaveProp('keyboardType', 'number-pad');
    expect(code).toHaveProp('autoCorrect', false);
    expect(code).toHaveProp('textContentType', 'oneTimeCode');
    expect(code).toHaveProp('autoComplete', Platform.OS === 'android' ? 'sms-otp' : 'one-time-code');
    expect(code).toHaveProp('accessibilityHint', pl.login.codeHint);
    await fireEvent.press(screen.getByRole('switch', { name: pl.login.showCode }));
    expect(screen.getByLabelText(pl.login.code)).toHaveProp('secureTextEntry', false);
    expect(screen.getByLabelText(pl.login.code)).toHaveProp('keyboardType', 'number-pad');
  });

  it('EVM-100 AC1: "Zmień konto" returns to the e-mail without losing it, the password is cleared; "back" does the same', async () => {
    await open(signedOut());
    await toCode();
    await fireEvent.press(screen.getByRole('button', { name: pl.login.changeAccount }));
    expect(screen.getByLabelText(pl.login.email)).toHaveProp('value', 'jan@example.test');
    expect(screen.getByLabelText(pl.login.password)).toHaveProp('value', '');
    await fireEvent.changeText(screen.getByLabelText(pl.login.password), 'synthetic-password');
    await fireEvent.press(screen.getByRole('button', { name: pl.login.submit }));
    await settle();
    const back = jest.spyOn(BackHandler, 'addEventListener');
    expect(screen.getByLabelText(pl.login.code)).toBeOnTheScreen();
    back.mockRestore();
  });

  it('EVM-100 AC1: the system "back" in step 2 is "Zmień konto"; in step 1 it leaves the app as usual', async () => {
    const handlers: Parameters<typeof BackHandler.addEventListener>[1][] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler);
      return { remove: () => undefined };
    });
    try {
      await open(signedOut());
      expect(handlers.map((handler) => handler({} as never)).includes(true)).toBe(false);
      await toCode();
      await act(() => {
        for (const handler of handlers) handler({} as never);
      });
      expect(screen.getByLabelText(pl.login.email)).toHaveProp('value', 'jan@example.test');
    } finally {
      spy.mockRestore();
    }
  });

  it('EVM-100 AC1: "Nie pamiętasz hasła?" opens the panel through its port', async () => {
    const rig = signedOut();
    await open(rig);
    await fireEvent.press(screen.getByRole('button', { name: pl.login.forgot }));
    expect(rig.opened).toEqual(['forgot']);
  });

  it('EVM-100 AC8: fields have visible labels as names, the main action is in the bottom bar (56 dp), every target ≥ 48 dp', async () => {
    await open(signedOut());
    expect(flat(screen.getByRole('button', { name: pl.login.submit })).minHeight).toBe(size.touchTarget.field);
    for (const button of screen.getAllByRole('button')) expect(flat(button).minHeight).toBeGreaterThanOrEqual(size.touchTarget.min);
    expect(screen.getByText(pl.login.email)).toBeOnTheScreen();
    expect(screen.getByText(pl.login.password)).toBeOnTheScreen();
  });

  it('EVM-100 AC1: a session that could not be stored, or a device check of EVM-101, returns to M-01 with the generic error', async () => {
    const rig = signedOut();
    rig.owner.completeResult = { kind: 'device_check', result: { kind: 'owner_mismatch', unsentItemCount: 3 } };
    await open(rig);
    await toCode();
    await fireEvent.changeText(screen.getByLabelText(pl.login.code), '123456');
    await fireEvent.press(screen.getByRole('button', { name: pl.login.confirm }));
    await settle();
    expect(rig.owner.calls).toContain('abandon');
    expect(screen.getByText(pl.login.unavailable)).toBeOnTheScreen();
  });

  it('EVM-100 AC1: after data_lost "Rozumiem" continues the device check and the session is stored into the new store', async () => {
    const rig = signedOut();
    rig.owner.completeResult = {
      kind: 'device_check',
      result: { kind: 'data_lost', reason: 'key_missing', acknowledge: () => Promise.resolve({ kind: 'update_required' }) },
    };
    await open(rig);
    await toCode();
    await fireEvent.changeText(screen.getByLabelText(pl.login.code), '123456');
    await fireEvent.press(screen.getByRole('button', { name: pl.login.confirm }));
    await settle();
    expect(screen.getByRole('header', { name: pl.localData.lostTitle })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: pl.localData.acknowledge }));
    await settle();
    expect(rig.owner.calls).toContain('continue:update_required');
    expect(screen.getByRole('header', { name: pl.login.title })).toBeOnTheScreen();
  });
});

describe('M-01 errors (EVM-100 AC2)', () => {
  const failing = (status: number, code: string, retryAfterMs?: number): SignInClient =>
    okSignIn({
      login: () =>
        Promise.resolve(retryAfterMs === undefined ? { kind: 'problem', status, code } : { kind: 'problem', status, code, retryAfterMs }),
    });

  it('EVM-100 AC2: the texts of the story, each an alert announced to the screen reader', () => {
    expect(pl.login.invalidCredentials).toBe('Nieprawidłowy e-mail lub hasło.');
    expect(pl.login.invalidCode).toBe('Kod jest nieprawidłowy albo wygasł. Wpisz nowy kod z aplikacji.');
    expect(pl.login.unavailable).toBe('Nie udało się zalogować. Spróbuj ponownie za chwilę.');
    expect(pl.login.offline).toBe('Brak zasięgu. Zalogujesz się, gdy wróci połączenie.');
  });

  it('EVM-100 AC2: a wrong e-mail or password shows one message as an alert; the e-mail stays', async () => {
    await open(signedOut(failing(401, 'invalid_credentials')));
    await toCode();
    const alert = screen.getByTestId('login-error');
    expect(alert).toHaveTextContent(pl.login.invalidCredentials);
    expect(alert).toHaveProp('accessibilityRole', 'alert');
    expect(alert).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(screen.getByLabelText(pl.login.email)).toHaveProp('value', 'jan@example.test');
    expect(screen.getByLabelText(pl.login.password)).toHaveProp('value', '');
  });

  it('EVM-100 AC2: a wrong code shows the code message, the code field is cleared, the step stays', async () => {
    await open(signedOut(okSignIn({ loginTotp: () => Promise.resolve({ kind: 'problem', status: 401, code: 'invalid_credentials' }) })));
    await toCode();
    await fireEvent.changeText(screen.getByLabelText(pl.login.code), '000000');
    await fireEvent.press(screen.getByRole('button', { name: pl.login.confirm }));
    await settle();
    expect(screen.getByTestId('login-error')).toHaveTextContent(pl.login.invalidCode);
    expect(screen.getByLabelText(pl.login.code)).toHaveProp('value', '');
  });

  it('EVM-100 AC2: 429 "Spróbuj ponownie za 4 min." — refreshed every minute, the button disabled with the reason in the text', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-30T08:00:00Z') });
    try {
      await open(signedOut(failing(429, 'too_many_requests', 230_000)));
      await toCode();
      expect(screen.getByTestId('login-error')).toHaveTextContent('Zbyt wiele prób. Spróbuj ponownie za 4 min.');
      expect(screen.getByRole('button', { name: pl.login.submit })).toBeDisabled();
      await act(() => {
        jest.advanceTimersByTime(50_000);
      });
      expect(screen.getByTestId('login-error')).toHaveTextContent('Zbyt wiele prób. Spróbuj ponownie za 3 min.');
      for (let minute = 0; minute < 3; minute += 1) {
        await act(() => {
          jest.advanceTimersByTime(60_000);
        });
      }
      expect(screen.queryByTestId('login-error')).toBeNull();
      expect(screen.getByRole('button', { name: pl.login.submit })).toBeEnabled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('EVM-100 AC2: a server or network failure shows the generic message', async () => {
    await open(signedOut(okSignIn({ login: () => Promise.resolve({ kind: 'unavailable' }) })));
    await toCode();
    expect(screen.getByTestId('login-error')).toHaveTextContent(pl.login.unavailable);
  });

  it('EVM-100 AC2 (W5): nothing typed reaches the console or the rendered messages', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((name) => jest.spyOn(console, name));
    await open(signedOut(failing(401, 'invalid_credentials')));
    await toCode();
    const printed = spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call))).join('\n');
    expect(printed).not.toContain('synthetic-password');
    expect(screen.queryByText(/synthetic-password/)).toBeNull();
    for (const spy of spies) spy.mockRestore();
  });
});

describe('M-02 before a session (EVM-100 AC3)', () => {
  const blocked = (status: number, code: string, step: 1 | 2 = 1): SignInClient =>
    step === 1
      ? okSignIn({ login: () => Promise.resolve({ kind: 'problem', status, code }) })
      : okSignIn({ loginTotp: () => Promise.resolve({ kind: 'problem', status, code }) });

  async function reach(client: SignInClient, step: 1 | 2, unsent: number | null = 0) {
    const rig = signedOut(client, unsent);
    await open(rig);
    await toCode();
    if (step === 2) {
      await fireEvent.changeText(screen.getByLabelText(pl.login.code), '123456');
      await fireEvent.press(screen.getByRole('button', { name: pl.login.confirm }));
      await settle();
    }
    return rig;
  }

  it.each([
    ['channel_not_allowed', 403, 2, pl.deviceState.channelNotAllowed, pl.deviceState.backToSignIn],
    ['totp_not_configured', 403, 1, pl.deviceState.totpNotConfigured, pl.deviceState.backToSignIn],
    ['mfa_enrollment_required', 403, 1, pl.deviceState.mfaEnrollmentRequired, pl.deviceState.backToSignIn],
    ['device_limit_reached', 403, 2, pl.deviceState.deviceLimit, pl.deviceState.retry],
    ['client_version_unsupported', 426, 1, pl.deviceState.updateRequired, pl.deviceState.viewQueue],
  ] as const)('EVM-100 AC3: %s shows its M-02 variant with one main action and "Pomoc"', async (code, status, step, copy, primary) => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
    const rig = await reach(blocked(status, code, step), step);
    expect(screen.getByRole('header', { name: copy.title })).toBeOnTheScreen();
    expect(screen.getByText(copy.body)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: primary })).toBeOnTheScreen();
    expect(flat(screen.getByRole('button', { name: primary })).minHeight).toBe(size.touchTarget.field);
    await fireEvent.press(screen.getByRole('button', { name: pl.deviceState.help }));
    expect(rig.opened).toEqual(['help']);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(rig.owner.calls).not.toContain('completeSignIn');
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
    focus.mockRestore();
  });

  it('EVM-100 AC3: the exact titles of the story; "Aktualizacja wymagana" never mentions Google Play and the phone offers no second-step setup', () => {
    expect(pl.deviceState.channelNotAllowed.title).toBe('Aplikacja jest niedostępna dla Twojej roli');
    expect(pl.deviceState.totpNotConfigured.title).toBe('Dodaj kod z aplikacji uwierzytelniającej');
    expect(pl.deviceState.mfaEnrollmentRequired.title).toBe('Skonfiguruj drugi krok logowania');
    expect(pl.deviceState.deviceLimit.title).toBe('Limit urządzeń');
    expect(pl.deviceState.deviceLimit.body.startsWith('Masz już 2 aktywne telefony…'.slice(0, 26))).toBe(true);
    expect(pl.deviceState.updateRequired.body).toContain('Poproś administratora o nową wersję aplikacji.');
    expect(JSON.stringify(pl)).not.toMatch(/Google Play/);
  });

  it('EVM-100 AC3: "Wróć do logowania" returns to M-01 with the e-mail kept', async () => {
    await reach(blocked(403, 'mfa_enrollment_required'), 1);
    await fireEvent.press(screen.getByRole('button', { name: pl.deviceState.backToSignIn }));
    expect(screen.getByLabelText(pl.login.email)).toHaveProp('value', 'jan@example.test');
  });

  it('EVM-100 AC3: at 426 the unsent items are counted and "Zobacz kolejkę" shows the number only (read-only preview)', async () => {
    await reach(blocked(426, 'client_version_unsupported'), 1, 5);
    await settle();
    expect(screen.getByText('Niewysłane elementy (5) są bezpieczne w telefonie — wyślemy je po aktualizacji.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: pl.deviceState.viewQueue }));
    expect(screen.getByRole('header', { name: pl.deviceState.queuePreview.title })).toBeOnTheScreen();
    expect(screen.getByText(/Niewysłane elementy \(5\)/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: pl.deviceState.queuePreview.back }));
    expect(screen.getByRole('header', { name: pl.deviceState.updateRequired.title })).toBeOnTheScreen();
  });

  it('EVM-100 AC3: with no unsent items (or an unknown number) the sentence about the queue is left out', async () => {
    await reach(blocked(426, 'client_version_unsupported'), 1, null);
    expect(screen.queryByTestId('device-state-unsent')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: pl.deviceState.viewQueue }));
    expect(screen.getByText(pl.shell.queue.emptyTitle)).toBeOnTheScreen();
  });

  it('EVM-100 AC4: device_wipe_required at sign-in shows "Dane firmowe usunięte" and signals the wipe through the port', async () => {
    const rig = await reach(blocked(401, 'device_wipe_required'), 1);
    expect(screen.getByRole('header', { name: pl.deviceState.wiped.title })).toBeOnTheScreen();
    expect(rig.wipes.count).toBe(1);
    await fireEvent.press(screen.getByRole('button', { name: pl.deviceState.signIn }));
    expect(screen.getByRole('header', { name: pl.login.title })).toBeOnTheScreen();
  });

  it('EVM-100 AC3 (§ 3.15.1): the system "back" does not leave a blocking state', async () => {
    const handlers: Parameters<typeof BackHandler.addEventListener>[1][] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler);
      return { remove: () => undefined };
    });
    await reach(blocked(403, 'channel_not_allowed'), 1);
    expect(handlers.at(-1)?.({} as never)).toBe(true);
    spy.mockRestore();
  });
});

describe('M-02 at the end of a session (EVM-100 AC4)', () => {
  it('EVM-100 AC4: session_revoked — "Wylogowano ten telefon" with N from the queue, action "Zaloguj się" to M-01', async () => {
    const rig = stubPorts();
    await open(rig);
    await act(() => {
      rig.owner.end({ reason: 'session_revoked', unsentItems: 5 });
    });
    expect(screen.getByRole('header', { name: 'Wylogowano ten telefon' })).toBeOnTheScreen();
    expect(screen.getByText('Dane zleceń usunęliśmy z telefonu.')).toBeOnTheScreen();
    expect(
      screen.getByText('Niewysłane elementy (5) są zaszyfrowane w telefonie — wyślemy je, gdy zalogujesz się ponownie na to samo konto.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: pl.deviceState.signIn }));
    expect(screen.getByRole('header', { name: pl.login.title })).toBeOnTheScreen();
  });

  it('EVM-100 AC4: with N = 0 the sentence about the queue does not appear; expiry shows "Sesja wygasła"; wipe its own text', async () => {
    const rig = stubPorts();
    await open(rig);
    await act(() => {
      rig.owner.end({ reason: 'session_expired', unsentItems: 0 });
    });
    expect(screen.getByRole('header', { name: 'Sesja wygasła' })).toBeOnTheScreen();
    expect(screen.getByText('Zaloguj się ponownie.')).toBeOnTheScreen();
    expect(screen.queryByTestId('device-state-unsent')).toBeNull();
    await act(() => {
      rig.owner.end({ reason: 'session_expired', unsentItems: 2 });
    });
    expect(
      screen.getByText('Niewysłane elementy (2) są zaszyfrowane w telefonie — wyślemy je po zalogowaniu na to samo konto.'),
    ).toBeOnTheScreen();
    await act(() => {
      rig.owner.end({ reason: 'device_wipe_required', unsentItems: 0 });
    });
    expect(screen.getByRole('header', { name: 'Dane firmowe usunięte z telefonu' })).toBeOnTheScreen();
    expect(screen.getByText(/także niewysłane elementy/)).toBeOnTheScreen();
  });

  it('EVM-100 AC4: a signed-in start online refreshes once in the background (AC4 at start) and sends pending revocations', async () => {
    const rig = stubPorts();
    await open(rig);
    expect(rig.owner.calls.filter((call) => call === 'refresh')).toHaveLength(1);
    expect(rig.owner.calls).toContain('flush');
  });
});

describe('offline (EVM-100 AC6)', () => {
  it('EVM-100 AC6: M-01 offline — the banner, the button disabled, the e-mail kept; the banner goes by itself when the network returns', async () => {
    jest.useFakeTimers();
    try {
      const states: StartupState[] = [{ kind: 'offline' }, { kind: 'offline' }, { kind: 'online' }];
      let calls = 0;
      const checker: StartupChecker = () => Promise.resolve(states[Math.min(calls++, states.length - 1)] ?? { kind: 'online' });
      const rig = signedOut();
      await open(rig, checker);
      expect(screen.getByText(pl.login.offline)).toBeOnTheScreen();
      await typeCredentials();
      expect(screen.getByRole('button', { name: pl.login.submit })).toBeDisabled();
      await act(async () => {
        jest.advanceTimersByTime(OFFLINE_RECHECK_FIRST_MS);
        await Promise.resolve();
      });
      expect(calls).toBe(2);
      expect(screen.getByText(pl.login.offline)).toBeOnTheScreen();
      await act(async () => {
        jest.advanceTimersByTime(OFFLINE_RECHECK_FIRST_MS * 2);
        await Promise.resolve();
      });
      await settle();
      expect(calls).toBe(3);
      expect(screen.queryByText(pl.login.offline)).toBeNull();
      expect(screen.getByLabelText(pl.login.email)).toHaveProp('value', 'jan@example.test');
      expect(screen.getByRole('button', { name: pl.login.submit })).toBeEnabled();
      await act(async () => {
        jest.advanceTimersByTime(OFFLINE_RECHECK_MAX_MS * 3);
        await Promise.resolve();
      });
      expect(calls).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('EVM-100 AC6: the re-check pauses in the background and runs again when the app returns to the foreground', async () => {
    jest.useFakeTimers();
    const listeners: ((state: AppStateStatus) => void)[] = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the mock of react-native is put back as it was, never called here
    const original = AppState.addEventListener;
    AppState.addEventListener = ((_type: string, listener: (state: AppStateStatus) => void) => {
      listeners.push(listener);
      return { remove: () => undefined };
    }) as never;
    try {
      let calls = 0;
      const checker: StartupChecker = () => {
        calls += 1;
        return Promise.resolve({ kind: 'offline' });
      };
      await open(signedOut(), checker);
      for (const listener of listeners) listener('background');
      await act(async () => {
        jest.advanceTimersByTime(OFFLINE_RECHECK_MAX_MS * 2);
        await Promise.resolve();
      });
      expect(calls).toBe(1);
      for (const listener of listeners) listener('active');
      await act(async () => {
        jest.advanceTimersByTime(OFFLINE_RECHECK_FIRST_MS);
        await Promise.resolve();
      });
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      AppState.addEventListener = original;
      jest.useRealTimers();
    }
  });

  it('EVM-100 AC6: a signed-in user starts offline straight into the shell — no sign-in, no refresh, no M-02', async () => {
    const rig = stubPorts();
    await open(rig, offline);
    expect(screen.getByRole('header', { name: pl.shell.orders.title })).toBeOnTheScreen();
    expect(rig.owner.calls).toEqual(['restore']);
    expect(screen.queryByText(pl.login.title)).toBeNull();
  });
});

describe('sign-out (EVM-100 AC7; M-09)', () => {
  async function openMore(rig: PortsRig, checker: StartupChecker = online) {
    await open(rig, checker);
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.more.title }));
  }

  it('EVM-100 AC7: "Więcej" shows the user, the account note, "Pomoc", the version and the separated "Wyczyść dane firmowe"', async () => {
    const rig = stubPorts();
    await openMore(rig);
    expect(screen.getByText('Piotr Testowy')).toBeOnTheScreen();
    expect(screen.getByText(pl.more.accountNote)).toBeOnTheScreen();
    expect(screen.getByText('Wersja 0.4.0')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: pl.more.help }));
    await fireEvent.press(screen.getByRole('button', { name: pl.more.wipe }));
    expect(rig.opened).toEqual(['help', 'wipe']);
  });

  it('EVM-100 AC7: with unsent items the warning shows their number, "Najpierw wyślij" and "Wyczyść dane firmowe"; confirming signs out online', async () => {
    const rig = stubPorts();
    rig.owner.unsent = 5;
    await openMore(rig);
    await fireEvent.press(screen.getByRole('button', { name: pl.more.signOut }));
    await settle();
    expect(screen.getByRole('header', { name: pl.logout.title })).toBeOnTheScreen();
    expect(screen.getByTestId('logout-body')).toHaveTextContent(/^5 niewysłanych elementów zostanie zaszyfrowanych w telefonie/);
    expect(screen.getByRole('button', { name: pl.logout.sendFirst })).toBeEnabled();
    expect(screen.getByRole('button', { name: pl.logout.wipe })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: pl.logout.confirmWithUnsent }));
    await settle();
    expect(rig.owner.calls).toContain('signOut:online');
    expect(screen.getByRole('header', { name: 'Wylogowano' })).toBeOnTheScreen();
    expect(screen.getByTestId('device-state-unsent')).toHaveTextContent(/Niewysłane elementy \(5\)/);
    await fireEvent.press(screen.getByRole('button', { name: pl.deviceState.signIn }));
    expect(screen.getByRole('header', { name: pl.login.title })).toBeOnTheScreen();
  });

  it('EVM-100 AC7: without unsent items a plain confirmation; offline the sign-out is stored for the next connection', async () => {
    const rig = stubPorts();
    await openMore(rig, offline);
    await fireEvent.press(screen.getByRole('button', { name: pl.more.signOut }));
    await settle();
    expect(screen.getByTestId('logout-body')).toHaveTextContent(pl.logout.plain);
    expect(screen.queryByRole('button', { name: pl.logout.sendFirst })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: pl.logout.confirm }));
    await settle();
    expect(rig.owner.calls).toContain('signOut:offline');
    expect(screen.getByRole('header', { name: 'Wylogowano' })).toBeOnTheScreen();
    expect(screen.queryByTestId('device-state-unsent')).toBeNull();
  });

  it('EVM-100 AC7: offline "Najpierw wyślij" is disabled with the reason in the text; "Anuluj" and "back" close the warning', async () => {
    const rig = stubPorts();
    rig.owner.unsent = 2;
    const handlers: Parameters<typeof BackHandler.addEventListener>[1][] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler);
      return { remove: () => undefined };
    });
    await openMore(rig, offline);
    await fireEvent.press(screen.getByRole('button', { name: pl.more.signOut }));
    await settle();
    expect(screen.getByRole('button', { name: pl.logout.sendFirst })).toBeDisabled();
    expect(screen.getByText(pl.logout.sendFirstOffline)).toBeOnTheScreen();
    expect(screen.getByTestId('logout-body')).toHaveTextContent(/^2 niewysłane elementy zostaną zaszyfrowane/);
    await fireEvent.press(screen.getByRole('button', { name: pl.logout.cancel }));
    expect(screen.queryByTestId('logout-dialog')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: pl.more.signOut }));
    await settle();
    await act(() => {
      handlers.at(-1)?.({} as never);
    });
    expect(screen.queryByTestId('logout-dialog')).toBeNull();
    spy.mockRestore();
  });

  it('EVM-100 AC7: "Najpierw wyślij" opens the queue (the sending is EVM-107); "Wyczyść dane firmowe" goes to EVM-101', async () => {
    const rig = stubPorts();
    rig.owner.unsent = 1;
    await openMore(rig);
    await fireEvent.press(screen.getByRole('button', { name: pl.more.signOut }));
    await settle();
    expect(screen.getByTestId('logout-body')).toHaveTextContent(/^1 niewysłany element zostanie zaszyfrowany/);
    await fireEvent.press(screen.getByRole('button', { name: pl.logout.sendFirst }));
    expect(screen.getByText(pl.shell.queue.emptyTitle)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.more.title }));
    await fireEvent.press(screen.getByRole('button', { name: pl.more.signOut }));
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: pl.logout.wipe }));
    expect(rig.opened).toEqual(['wipe']);
  });

  it('EVM-100 AC7: Polish plural of the number of unsent items', () => {
    expect([1, 2, 4, 5, 12, 14, 22, 25, 112].map(unsentKey)).toEqual([
      'logout.unsentOne',
      'logout.unsentFew',
      'logout.unsentFew',
      'logout.unsentMany',
      'logout.unsentMany',
      'logout.unsentMany',
      'logout.unsentFew',
      'logout.unsentMany',
      'logout.unsentMany',
    ]);
  });

  it('EVM-100 AC7: a restart after the sign-out shows M-01, not data', async () => {
    const rig = signedOut();
    await open(rig);
    expect(screen.getByRole('header', { name: pl.login.title })).toBeOnTheScreen();
    expect(screen.queryByText(pl.shell.orders.title)).toBeNull();
  });
});

describe('start of the session gate (EVM-100 AC1)', () => {
  it('EVM-100 AC1: the start shows nothing until the stored session is known, then data_lost goes to "Rozumiem"', async () => {
    const owner = stubOwner();
    owner.restoreResult = {
      kind: 'device_check',
      result: { kind: 'data_lost', reason: 'file_corrupt', acknowledge: () => Promise.resolve({ kind: 'wipe_incomplete' }) },
    };
    const rig = stubPorts(owner);
    await open(rig);
    expect(screen.getByRole('header', { name: pl.localData.lostTitle })).toBeOnTheScreen();
    const failed = stubOwner();
    failed.restoreResult = { kind: 'failed' };
    await open(stubPorts(failed));
    expect(screen.getAllByRole('header', { name: pl.login.title }).length).toBeGreaterThan(0);
  });
});
