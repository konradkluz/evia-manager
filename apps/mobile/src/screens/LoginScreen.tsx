import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, BackHandler, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lockMinutes, type LoginMachine, type LoginState } from '../auth/login-machine';
import { useStartup } from '../startup';
import { BottomBar, Button, InlineAlert, TextField } from '../ui';
import { color, space, text } from '../ui/theme';

/** Re-check of the connection while M-01 is offline (architect 7): 10 s, doubling up to 60 s, foreground only. */
export const OFFLINE_RECHECK_FIRST_MS = 10_000;
export const OFFLINE_RECHECK_MAX_MS = 60_000;

/** While the sign-in screen shows "Brak zasięgu", the health check runs again by itself, so the banner goes when the network returns. */
function useOfflineRecheck(offline: boolean, retry: () => void) {
  useEffect(() => {
    if (!offline) return undefined;
    let delay = OFFLINE_RECHECK_FIRST_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // the screen is visible, so the app is in the foreground; the timer stops in the background (no battery spent there)
    const schedule = () => {
      timer = setTimeout(() => {
        retry();
        delay = Math.min(delay * 2, OFFLINE_RECHECK_MAX_MS);
        schedule();
      }, delay);
    };
    schedule();
    const subscription = AppState.addEventListener('change', (next) => {
      clearTimeout(timer);
      if (next === 'active') {
        // StartupProvider checks at once on the return; the series starts again from the shortest wait
        delay = OFFLINE_RECHECK_FIRST_MS;
        schedule();
      }
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [offline, retry]);
}

/** Re-renders when the next whole minute of a `429` lock passes (AC2: the text is refreshed every minute) and ends the lock. */
function useLockClock(machine: LoginMachine, state: LoginState, now: () => number): number {
  const [current, setCurrent] = useState(now);
  useEffect(() => {
    if (state.lockedUntil === null) return undefined;
    const left = state.lockedUntil - now();
    const timer = setTimeout(
      () => {
        setCurrent(now());
        machine.tick();
      },
      left <= 0 ? 0 : left % 60_000 || 60_000,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [machine, state.lockedUntil, current, now]);
  return current;
}

const ERROR_TEXT = {
  invalid_credentials: 'login.invalidCredentials',
  invalid_code: 'login.invalidCode',
  unavailable: 'login.unavailable',
  challenge_expired: 'login.challengeExpired',
} as const;

/**
 * M-01 "Logowanie w aplikacji" (EVM-100 AC1, AC2, AC6, AC8; UX 01 and 16): step 1 e-mail and password, step 2 the 6-digit code.
 * `color.bg.brand` with the main action in the bottom bar; content scrolls at 200 % font size. Masked fields have "Pokaż"/"Ukryj";
 * messages are alerts announced to the screen reader and never contain what was typed. Offline: the banner, the action disabled with
 * the reason in the text, the e-mail kept; the banner goes by itself when the network returns.
 */
export function LoginScreen({
  machine,
  onForgotPassword,
  now = Date.now,
}: {
  machine: LoginMachine;
  onForgotPassword: () => void;
  now?: () => number;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { state: startup, retry } = useStartup();
  const state = useSyncExternalStore(machine.subscribe, machine.getState);
  const [passwordShown, setPasswordShown] = useState(false);
  const [codeShown, setCodeShown] = useState(false);
  const offline = startup.kind === 'offline';
  const online = !offline;
  const clock = useLockClock(machine, state, now);
  const minutes = lockMinutes(state, clock);
  useOfflineRecheck(offline, retry);

  // a challenge left in the background longer than it lives is dropped on return (security W2)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') machine.checkChallenge();
    });
    return () => {
      subscription.remove();
    };
  }, [machine]);

  // "back" in step 2 is "Zmień konto"
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (machine.state.step !== 'code') return false;
      machine.changeAccount();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [machine]);

  const codeStep = state.step === 'code';
  const submit = () => {
    if (codeStep) void machine.submitCode(online);
    else void machine.submitCredentials(online);
  };
  const message = minutes > 0 ? t('login.locked', { minutes }) : state.error === null ? null : t(ERROR_TEXT[state.error]);

  return (
    <View style={{ flex: 1, backgroundColor: color.bg.brand, paddingTop: insets.top }}>
      <StatusBar style="light" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, padding: space.inset.md, rowGap: space.stack.md }}
      >
        <Text style={{ ...text.labelLg, color: color.text.onBrand }}>{t('shell.appName')}</Text>
        <Text accessibilityRole="header" style={{ ...text.heading1, color: color.text.onBrand }}>
          {t('login.title')}
        </Text>
        {offline ? <InlineAlert tone="info" body={t('login.offline')} testID="login-offline" /> : null}
        {message === null ? null : <InlineAlert tone="error" body={message} testID="login-error" />}
        {codeStep ? (
          <>
            <TextField
              label={t('login.code')}
              hint={t('login.codeHint')}
              value={state.code}
              onChangeText={(value) => {
                machine.setCode(value);
              }}
              invalid={state.error === 'invalid_code'}
              numeric
              inverse
              editable={!state.busy}
              autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
              textContentType="oneTimeCode"
              returnKeyType="done"
              onSubmitEditing={submit}
              secure={{
                shown: codeShown,
                onToggle: () => {
                  setCodeShown((shown) => !shown);
                },
                showLabel: t('login.show'),
                hideLabel: t('login.hide'),
                showName: t('login.showCode'),
                hideName: t('login.hideCode'),
              }}
              testID="login-code"
            />
            <View style={{ alignSelf: 'flex-start' }}>
              <Button
                label={t('login.changeAccount')}
                variant="tertiary"
                inverse
                onPress={() => {
                  machine.changeAccount();
                }}
                testID="login-change-account"
              />
            </View>
          </>
        ) : (
          <>
            <TextField
              label={t('login.email')}
              value={state.email}
              onChangeText={(value) => {
                machine.setEmail(value);
              }}
              inverse
              editable={!state.busy}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="username"
              returnKeyType="next"
              testID="login-email"
            />
            <TextField
              label={t('login.password')}
              value={state.password}
              onChangeText={(value) => {
                machine.setPassword(value);
              }}
              invalid={state.error === 'invalid_credentials'}
              inverse
              editable={!state.busy}
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
              secure={{
                shown: passwordShown,
                onToggle: () => {
                  setPasswordShown((shown) => !shown);
                },
                showLabel: t('login.show'),
                hideLabel: t('login.hide'),
                showName: t('login.showPassword'),
                hideName: t('login.hidePassword'),
              }}
              testID="login-password"
            />
            <View style={{ alignSelf: 'flex-start' }}>
              <Button label={t('login.forgot')} variant="tertiary" inverse onPress={onForgotPassword} testID="login-forgot" />
            </View>
          </>
        )}
      </ScrollView>
      <BottomBar>
        <Button
          label={t(codeStep ? 'login.confirm' : 'login.submit')}
          onPress={submit}
          buttonSize="lg"
          fullWidth
          busy={state.busy}
          disabled={!state.busy && !machine.canSubmit(online)}
          testID="login-submit"
        />
      </BottomBar>
    </View>
  );
}
