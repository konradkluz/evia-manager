import { CameraView } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, AppState, BackHandler, Text, View } from 'react-native';
import { PICTURE_OPTIONS, consentMemory } from '../capture/camera-options';
import { useCameraPermission } from '../capture/camera-permission';
import type { CapturePipeline } from '../capture/capture-pipeline';
import { diskLevel } from '../capture/disk-space';
import { formatFreeSpace } from '../i18n/format';
import { pluralKey } from '../i18n/plural';
import { AppBar, Button, CameraPanel, CameraShutter, Camera, EmptyState, FilterChip, InlineAlert, Toast } from '../ui';
import { color, space, text } from '../ui/theme';
import { MEDIA_CATEGORIES, type MediaCategory } from '../upload/create-media-asset';
import { CameraPermissionScreen } from './CameraPermissionScreen';
import { NotificationConsentSheet } from './NotificationConsentSheet';
import { SyncCapsule } from './SyncCapsule';
import { useGuard, useMediaSnapshot, useSession } from './session-context';

type Problem = 'noSpace' | 'saveFailed';
type CameraState = 'starting' | 'ready' | 'failed';

const PROBLEM_KEY: Readonly<Record<Problem, 'camera.noSpace' | 'camera.saveFailed'>> = {
  noSpace: 'camera.noSpace',
  saveFailed: 'camera.saveFailed',
};

const CATEGORY_KEY: Readonly<Record<MediaCategory, string>> = {
  site_survey: 'camera.categories.site_survey',
  before_work: 'camera.categories.before_work',
  in_progress: 'camera.categories.in_progress',
  completed_work: 'camera.categories.completed_work',
  defect: 'camera.categories.defect',
  measurement: 'camera.categories.measurement',
  other: 'camera.categories.other',
};

/** `true` while the app is in the foreground (the camera is released in the background and while the app is locked); the screen opens in the foreground. */
function useForeground(): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setActive(next === 'active');
    });
    return () => {
      subscription.remove();
    };
  }, []);
  return active;
}

/**
 * The top bar shows the NUMBER of the order and nothing else (styleguide § 3.24; no customer, address or title). In the hidden-data mode no number
 * is read or drawn at all (EVM-108 AC5; the bar says "Aparat"); an order without a number says "Oczekuje na numer". The read takes ids and
 * numbers only (`orderList(false)`), so it holds no personal data.
 */
function useBarTitle(orderId: string): string {
  const { t } = useTranslation();
  const { sync } = useSession();
  const hidden = useGuard().hidden !== null;
  const [found, setFound] = useState<{ readonly id: string; readonly number: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    if (hidden) {
      setFound(null);
      return () => {
        active = false;
      };
    }
    sync.orderList(false).then(
      (rows) => {
        const row = rows.find((candidate) => candidate.id === orderId);
        if (active && row !== undefined) setFound({ id: orderId, number: row.number });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [sync, orderId, hidden]);
  if (hidden || found === null || found.id !== orderId) return t('camera.title');
  return found.number ?? t('shell.orders.awaitingNumber');
}

function Bar({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <AppBar
      title={useBarTitle(orderId)}
      left={
        <Button
          label={t('camera.close')}
          accessibilityLabel={t('camera.closeA11y')}
          variant="tertiary"
          inverse
          onPress={onClose}
          testID="camera-close"
        />
      }
      // the capsule of the synchronization without a banner: it would cover the preview (styleguide § 5.4, exception of § 3.24)
      right={<SyncCapsule onPress={() => undefined} />}
    />
  );
}

/**
 * M-06 "Aparat" (EVM-108 AC1-AC4): the camera of the app (the photo only: no microphone, no film, no torch, no description in version 1).
 * - the picture goes through the durable save of the session (`capturePipeline`): the counter and the toast come only AFTER the file, the
 *   command and the row are saved; a failure says so in words and leaves the queue and the counter as they were;
 * - `active` (the preview and the camera of the phone) only while the screen is the one in front, the app is in the foreground and the app
 *   lock is open; the options of `takePictureAsync` are one constant (`PICTURE_OPTIONS`);
 * - the first picture of the order needs a category (the shutter says why it is blocked), the next ones take the last one chosen;
 * - "Gotowe" (and the system "back") waits for a save in progress, then returns to the order; after the first one with something in the queue
 *   the explaining sheet of the notifications is shown once per process (a refusal never blocks the work).
 */
function CameraCapture({ orderId, onClose, focused }: { orderId: string; onClose: () => void; focused: boolean }) {
  const { t } = useTranslation();
  const { media } = useSession();
  const snapshot = useMediaSnapshot();
  const locked = useGuard().locked;
  const foreground = useForeground();
  const cameraRef = useRef<CameraView | null>(null);
  const [pipeline] = useState<CapturePipeline>(() =>
    media.capturePipeline(async () => {
      const picture = await cameraRef.current?.takePictureAsync(PICTURE_OPTIONS);
      return picture === undefined ? null : { uri: picture.uri };
    }),
  );
  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [attempt, setAttempt] = useState(0);
  const [category, setCategory] = useState<MediaCategory | null>(null);
  const [count, setCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [free, setFree] = useState<number | null>(() => media.freeDiskBytes());
  const [finishing, setFinishing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [savedKey, setSavedKey] = useState(0);
  // the latest values for the handlers that outlive a render (the system "back")
  const latest = useRef({ count, notifications: snapshot.notifications, queued: snapshot.files.some((file) => file.status !== 'sent') });
  latest.current = { count, notifications: snapshot.notifications, queued: snapshot.files.some((file) => file.status !== 'sent') };

  // the toast of the earlier shot goes with its timer (styleguide 3.14) and never stays over the result of the next one
  const dismissSaved = useCallback(() => {
    setSavedKey(0);
  }, []);

  const shoot = useCallback(() => {
    if (category === null || saving) return;
    setSaving(true);
    setProblem(null);
    setSavedKey(0);
    void pipeline.capture({ workOrderId: orderId, category }).then((result) => {
      setSaving(false);
      setFree(media.freeDiskBytes());
      if (result.ok) {
        // the saves are one after another (the shutter waits for the previous one), so the rendered count is the current one
        AccessibilityInfo.announceForAccessibility(t('camera.savedA11y', { count: latest.current.count + 1 }));
        setCount((current) => current + 1);
        setSavedKey((key) => key + 1);
      } else if (result.code === 'no_space') setProblem('noSpace');
      else if (result.code !== 'busy') setProblem('saveFailed');
    });
  }, [category, saving, pipeline, orderId, media, t]);

  const finish = useCallback(() => {
    setFinishing(true);
    void pipeline.whenIdle().then(() => {
      const { count: taken, notifications, queued } = latest.current;
      if ((taken > 0 || queued) && notifications === 'denied' && !consentMemory.shown) {
        consentMemory.shown = true;
        setConsent(true);
        return;
      }
      onClose();
    });
  }, [pipeline, onClose]);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      finishRef.current();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, []);

  const retry = useCallback(() => {
    setCameraState('starting');
    setAttempt((n) => n + 1);
  }, []);

  if (cameraState === 'failed') {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg.canvas }} testID="camera">
        <Bar orderId={orderId} onClose={finish} />
        <EmptyState
          icon={Camera}
          title={t('camera.startFailed')}
          action={<Button label={t('camera.retry')} onPress={retry} buttonSize="lg" fullWidth testID="camera-retry" />}
          testID="camera-failed"
        />
      </View>
    );
  }

  const level = diskLevel(free);
  const needsCategory = category === null;
  const notice =
    problem !== null || level !== 'ok' || needsCategory ? (
      <View style={{ rowGap: space.stack.sm }}>
        {problem !== null ? (
          <InlineAlert tone="error" body={t(PROBLEM_KEY[problem])} testID="camera-problem" />
        ) : level !== 'ok' && free !== null ? (
          <InlineAlert tone="warning" body={t('camera.lowSpace', { free: formatFreeSpace(free) })} testID="camera-low-space" />
        ) : null}
        {needsCategory ? (
          <Text style={{ ...text.body, color: color.text.onBrand }} testID="camera-choose-category">
            {t('camera.chooseCategory')}
          </Text>
        ) : null}
      </View>
    ) : undefined;
  const countKey = pluralKey(count, { one: 'camera.count_one', few: 'camera.count_few', many: 'camera.count_many' });
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.inverse }} testID="camera">
      <Bar orderId={orderId} onClose={finish} />
      <View style={{ flex: 1 }}>
        <CameraView
          key={attempt}
          ref={cameraRef}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          facing="back"
          mode="picture"
          active={focused && foreground && !locked}
          onCameraReady={() => {
            setCameraState('ready');
          }}
          onMountError={() => {
            setCameraState('failed');
          }}
        />
        {cameraState === 'starting' ? (
          <View
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }}
            testID="camera-loading"
          >
            <Text style={{ ...text.body, color: color.text.inverse }}>{t('camera.loading')}</Text>
          </View>
        ) : null}
        {savedKey > 0 ? (
          <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} pointerEvents="none">
            <Toast key={savedKey} message={t('camera.saved')} onDismiss={dismissSaved} testID="camera-toast" />
          </View>
        ) : null}
      </View>
      <CameraPanel
        chipsLabel={t('camera.categoryGroup')}
        notice={notice}
        chips={MEDIA_CATEGORIES.map((item) => (
          <FilterChip
            key={item}
            label={t(CATEGORY_KEY[item])}
            accessibilityLabel={t(CATEGORY_KEY[item])}
            selected={category === item}
            radio
            onDark
            onPress={() => {
              setCategory(item);
            }}
            testID={`camera-category-${item}`}
          />
        ))}
        counter={
          <Text style={{ ...text.body, color: color.text.onBrand }} testID="camera-count">
            {t(countKey, { count })}
          </Text>
        }
        shutter={
          <CameraShutter
            accessibilityLabel={t('camera.shutter')}
            accessibilityHint={needsCategory ? t('camera.chooseCategory') : t('camera.shutterHint')}
            disabled={needsCategory || saving || cameraState !== 'ready'}
            onPress={shoot}
            testID="camera-shutter"
          />
        }
        done={
          <Button
            label={t('camera.done')}
            accessibilityLabel={t('camera.doneA11y')}
            onPress={finish}
            busy={finishing}
            inverse
            buttonSize="lg"
            testID="camera-done"
          />
        }
      />
      {consent ? (
        <NotificationConsentSheet
          onAllow={() => {
            void media.requestNotifications().finally(onClose);
          }}
          onLater={() => {
            setConsent(false);
            onClose();
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * The camera of one work order, hosted by the shell as an overlay (like the entry form). The permission decides the screen: the explaining
 * screen (EVM-108 AC3) or the camera; while the first reading of the permission is on its way the text of the start is shown.
 */
export function CameraScreen({ orderId, onClose, focused = true }: { orderId: string; onClose: () => void; focused?: boolean }) {
  const { t } = useTranslation();
  const permission = useCameraPermission();
  if (permission.state === null) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg.inverse, alignItems: 'center', justifyContent: 'center' }} testID="camera-loading">
        <Text style={{ ...text.body, color: color.text.inverse }}>{t('camera.loading')}</Text>
      </View>
    );
  }
  if (permission.state !== 'granted') {
    return (
      <CameraPermissionScreen
        state={permission.state}
        onAllow={permission.request}
        onLater={onClose}
        onOpenSettings={permission.openSettings}
      />
    );
  }
  return <CameraCapture orderId={orderId} onClose={onClose} focused={focused} />;
}
