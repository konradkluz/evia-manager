import { Activity, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { afterFirstFrames } from './after-frames';
import type { AppStateSource } from '../device-guard/ports';
import { Button, InlineAlert, Lock } from '../ui';
import { Icon } from '../ui/Icon';
import { color, space, text } from '../ui/theme';

/**
 * Cover of the locked app (EVM-101 AC3, P7): opaque, above everything, with one action. It asks for the system unlock by itself
 * only in the foreground and after the first frame and the start animation (a request sent while the activity is still starting
 * is dropped by the system), and again after every return from the background; "Odblokuj" asks at any moment, also while an
 * earlier request is open (the button is never disabled). The content below is taken out of reach by `LockGate`.
 * A cancelled unlock keeps it; a failed one adds the hint `lock.failed`.
 */
export function LockOverlay({
  prompting,
  failed,
  appState,
  onUnlock,
}: {
  prompting: boolean;
  failed: boolean;
  appState: AppStateSource;
  onUnlock: (auto: boolean) => void;
}) {
  const { t } = useTranslation();
  // the `inactive` <-> `active` moves of the system window itself never ask again (no loop after a cancel); a `background` is remembered
  const busy = useRef(prompting);
  busy.current = prompting;
  const ask = useRef(onUnlock);
  ask.current = onUnlock;
  // the first request of this cover happens once (an effect that runs twice, e.g. in development, must not ask twice)
  const firstDone = useRef(false);
  useEffect(() => {
    let alive = true;
    let pending: { cancel: () => void } | undefined;
    const askWhenIdle = () => {
      pending?.cancel();
      pending = afterFirstFrames(() => {
        pending = undefined;
        firstDone.current = true;
        if (alive && !busy.current && appState.current() === 'active') ask.current(true);
      });
    };
    let left = appState.current() !== 'active'; // started in the background: the return asks
    const stop = appState.subscribe((next) => {
      // a real trip to the background counts also while a request is open (the system may cancel the window meanwhile); only the
      // inactive <-> active moves caused by the system window itself are ignored, and so is the return while the request is still open
      if (next === 'background') left = true;
      else if (busy.current) {
        if (next === 'active') left = false; // the window survived the trip: nothing to ask again
      } else if (next === 'active' && left) {
        left = false;
        askWhenIdle();
      }
    });
    if (appState.current() === 'active' && !firstDone.current) askWhenIdle();
    return () => {
      alive = false;
      pending?.cancel();
      stop();
    };
  }, [appState]);
  return (
    <View
      testID="lock-overlay"
      accessibilityViewIsModal
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: color.bg.canvas,
        justifyContent: 'center',
        alignItems: 'center',
        padding: space.inset.lg,
        rowGap: space.stack.md,
      }}
    >
      <Icon icon={Lock} color={color.text.secondary} iconSize="2xl" />
      <Text accessibilityRole="header" style={{ ...text.heading2, color: color.text.primary, textAlign: 'center' }}>
        {t('lock.title')}
      </Text>
      <Text style={{ ...text.body, color: color.text.secondary, textAlign: 'center' }}>{t('lock.body')}</Text>
      <Button
        label={t('lock.unlock')}
        onPress={() => {
          onUnlock(false);
        }}
        buttonSize="lg"
        fullWidth
        testID="lock-unlock"
      />
      {failed ? <InlineAlert tone="error" body={t('lock.failed')} live="assertive" testID="lock-failed" /> : null}
    </View>
  );
}

/**
 * The signed-in content, taken out of reach (touch and screen reader) while the app is locked; the cover sits above it.
 *
 * EVM-146 (SR-MOB-03, SR-MOB-08): covering is not enough - the views under an opaque cover are still in the tree that `adb shell uiautomator dump` and
 * the accessibility services read (also the views "not important for accessibility"). `Activity mode="hidden"` takes them out of the native tree while
 * the React state stays in memory (typed fields, the open order, the search): an unmount would lose it, and the data may not go to the disk. Its effects
 * are cleaned while hidden and run again at the unlock, so a screen must not depend on an event that came meanwhile (see `useForeground`). The `pointerEvents`,
 * `accessibilityElementsHidden` and `importantForAccessibility` props stay as a second safeguard. The emulator test (`tools/mobile-e2e`, flows 130-135)
 * reads the real tree and is the safeguard of THIS choice: the test renderer lists a hidden `Activity` anyway, so Jest cannot see the difference.
 */
export function LockGate({
  locked,
  prompting,
  failed,
  appState,
  onUnlock,
  children,
}: {
  locked: boolean;
  prompting: boolean;
  failed: boolean;
  appState: AppStateSource;
  onUnlock: (auto: boolean) => void;
  children: ReactNode;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View
        testID="lock-content"
        style={{ flex: 1 }}
        pointerEvents={locked ? 'none' : 'auto'}
        accessibilityElementsHidden={locked}
        importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}
      >
        <Activity mode={locked ? 'hidden' : 'visible'}>{children}</Activity>
      </View>
      {locked ? <LockOverlay prompting={prompting} failed={failed} appState={appState} onUnlock={onUnlock} /> : null}
    </View>
  );
}
