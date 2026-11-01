import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button, Lock } from '../ui';
import { Icon } from '../ui/Icon';
import { color, space, text } from '../ui/theme';

/**
 * Cover of the locked app (EVM-101 AC3, P7): opaque, above everything, with one action. It asks for the system unlock when it
 * appears and again on "Odblokuj". The content below is taken out of reach by `LockGate`. A cancelled unlock keeps it.
 */
export function LockOverlay({ prompting, onUnlock }: { prompting: boolean; onUnlock: () => void }) {
  const { t } = useTranslation();
  const asked = useRef(false);
  useEffect(() => {
    if (!asked.current) {
      asked.current = true;
      onUnlock();
    }
  }, [onUnlock]);
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
      <Button label={t('lock.unlock')} onPress={onUnlock} busy={prompting} buttonSize="lg" fullWidth testID="lock-unlock" />
    </View>
  );
}

/** The signed-in content, taken out of reach (touch and screen reader) while the app is locked; the cover sits above it. */
export function LockGate({
  locked,
  prompting,
  onUnlock,
  children,
}: {
  locked: boolean;
  prompting: boolean;
  onUnlock: () => void;
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
        {children}
      </View>
      {locked ? <LockOverlay prompting={prompting} onUnlock={onUnlock} /> : null}
    </View>
  );
}
