import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, InlineAlert } from '../ui';
import { space } from '../ui/theme';
import { useSession } from './session-context';

/**
 * EVM-110 AC3: after a start that found the marker of a recording killed with the process, ONCE: "Poprzednie nagranie zostało przerwane i nie zostało
 * zapisane." (Banner, `color.feedback.info.*`, with "Zamknij"). It names no order and no film, so it is the same in the hidden-data mode. The marker is
 * removed when it is read, so a second start shows nothing.
 */
export function InterruptedRecordingNotice() {
  const { t } = useTranslation();
  const { media } = useSession();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let active = true;
    void media.consumeInterruptedRecording().then((found) => {
      if (active && found) setShown(true);
    });
    return () => {
      active = false;
    };
  }, [media]);
  if (!shown) return null;
  return (
    <View style={{ paddingHorizontal: space.inset.md, paddingTop: space.stack.sm }}>
      <InlineAlert
        tone="info"
        body={t('camera.previousInterrupted')}
        action={
          <Button
            variant="tertiary"
            label={t('camera.previousInterruptedClose')}
            onPress={() => {
              setShown(false);
            }}
            testID="interrupted-recording-close"
          />
        }
        testID="interrupted-recording"
      />
    </View>
  );
}
