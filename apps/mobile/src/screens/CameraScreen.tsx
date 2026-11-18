import { CameraView } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, AppState, BackHandler, Text, View } from 'react-native';
import { PICTURE_OPTIONS, VIDEO_MAX_SECONDS, VIDEO_VIEW_PROPS, VIDEO_WARN_AT_SECONDS, consentMemory } from '../capture/camera-options';
import { useCameraPermission } from '../capture/camera-permission';
import type { CapturePipeline, VideoEnd, VideoRecording, VideoResult, VideoSource } from '../capture/capture-pipeline';
import { diskLevel, videoDiskLevel } from '../capture/disk-space';
import { formatDuration, formatFreeSpace } from '../i18n/format';
import { pluralKey } from '../i18n/plural';
import {
  AppBar,
  Button,
  CameraPanel,
  CameraShutter,
  Camera,
  EmptyState,
  FilterChip,
  HardDrive,
  Icon,
  InlineAlert,
  Toast,
  TriangleAlert,
  VolumeOff,
} from '../ui';
import { color, radius, space, text } from '../ui/theme';
import { MEDIA_CATEGORIES, type MediaCategory } from '../upload/create-media-asset';
import { CameraPermissionScreen } from './CameraPermissionScreen';
import { NotificationConsentSheet } from './NotificationConsentSheet';
import { SyncCapsule } from './SyncCapsule';
import { useGuard, useMediaSnapshot, useSession } from './session-context';

type Problem = 'noSpace' | 'saveFailed' | 'videoSaveFailed' | 'videoNoSpace';
type Mode = 'photo' | 'video';
type CameraState = 'starting' | 'ready' | 'failed';

const PROBLEM_KEY: Readonly<Record<Problem, 'camera.noSpace' | 'camera.saveFailed' | 'camera.videoSaveFailed' | 'camera.videoNoSpace'>> = {
  noSpace: 'camera.noSpace',
  saveFailed: 'camera.saveFailed',
  videoSaveFailed: 'camera.videoSaveFailed',
  videoNoSpace: 'camera.videoNoSpace',
};

/** The toast of the end of a film: the way it ended decides the words (EVM-110 AC2, AC3). */
const VIDEO_END_KEY: Readonly<Record<VideoEnd, string>> = {
  stopped: 'camera.savedVideo',
  time_limit: 'camera.limitTime',
  size_limit: 'camera.limitSize',
  no_space: 'camera.limitSpace',
  interrupted: 'camera.interrupted',
};

const MAX_CLOCK = formatDuration(VIDEO_MAX_SECONDS * 1000);

/** After this a camera that restarted for another mode and sent no `onCameraReady` is taken as ready (a long start of the camera shows "Uruchamianie aparatu…" longer). */
const MODE_RESTART_MS = 6000;

/** The marker and the counter sit on the preview, which can be any colour: each on its own dark chip (as the Toast). */
const overlayChip = {
  backgroundColor: color.bg.inverse,
  borderRadius: radius.control,
  padding: space.inset.sm,
} as const;

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
function useForeground(onLoseForeground: () => void): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      // EVM-110 AC3: a recording is told to stop BEFORE the view is deactivated (the same turn), so the library ends the file instead of losing it
      if (next !== 'active') onLoseForeground();
      setActive(next === 'active');
    });
    return () => {
      subscription.remove();
    };
  }, [onLoseForeground]);
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
 * M-06 "Aparat" (EVM-108 AC1-AC4, EVM-110 AC1-AC3, AC6): the camera of the app: a photo or a film WITHOUT sound (the view is muted by a constant; no microphone, no torch, no description).
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
  const { media, sync } = useSession();
  const snapshot = useMediaSnapshot();
  const locked = useGuard().locked;
  const loseForeground = useRef<() => void>(() => undefined);
  const onLoseForeground = useCallback(() => {
    loseForeground.current();
  }, []);
  const foreground = useForeground(onLoseForeground);
  const cameraRef = useRef<CameraView | null>(null);
  // the last view that existed: the screen going away detaches `cameraRef` BEFORE its cleanup runs, and that cleanup must still be able to stop a recording
  const lastCameraRef = useRef<CameraView | null>(null);
  const [pipeline] = useState<CapturePipeline>(() => {
    // the film (EVM-110): `recordAsync` and `stopRecording` of the view; the options come from the constants of `camera-options` (SEC-110-02)
    const video: VideoSource = {
      record: async (options) => {
        const recorded = await cameraRef.current?.recordAsync(options);
        return recorded === undefined ? null : { uri: recorded.uri };
      },
      stop: () => {
        (cameraRef.current ?? lastCameraRef.current)?.stopRecording();
      },
    };
    return media.capturePipeline(async () => {
      const picture = await cameraRef.current?.takePictureAsync(PICTURE_OPTIONS);
      return picture === undefined ? null : { uri: picture.uri };
    }, video);
  });
  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<Mode>('photo');
  const [category, setCategory] = useState<MediaCategory | null>(null);
  // a site survey starts with "Oględziny" (EVM-137 AC3); a category the technician already chose is never overwritten
  useEffect(() => {
    let active = true;
    sync.isSurvey(orderId).then(
      (survey) => {
        if (active && survey) setCategory((current) => current ?? 'site_survey');
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [sync, orderId]);
  const [count, setCount] = useState(0);
  const [videoCount, setVideoCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [free, setFree] = useState<number | null>(() => media.freeDiskBytes());
  const [finishing, setFinishing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [toast, setToast] = useState<{ readonly key: number; readonly message: string; readonly spoken?: boolean } | null>(null);
  // the film: the recording in progress, its seconds (from the progress of the view), and the save after the end ("Zapisywanie filmu…")
  const recordingRef = useRef<VideoRecording | null>(null);
  // the announcement of the last minute is made once per recording
  const warned = useRef(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [savingVideo, setSavingVideo] = useState(false);
  // the stop was asked for (the shutter, the foreground, the lock): the shutter does nothing more until the film is saved
  const [stopping, setStopping] = useState(false);
  // the latest values for the handlers that outlive a render (the system "back")
  const taken = count + videoCount;
  const queued = snapshot.files.length > 0;
  const latest = useRef({ count, taken, notifications: snapshot.notifications, queued });
  latest.current = { count, taken, notifications: snapshot.notifications, queued };

  // the toast of the earlier shot goes with its timer (styleguide 3.14) and never stays over the result of the next one
  const dismissSaved = useCallback(() => {
    setToast(null);
  }, []);
  const say = useCallback((message: string): void => {
    AccessibilityInfo.announceForAccessibility(message);
    setToast((current) => ({ key: (current?.key ?? 0) + 1, message, spoken: true }));
  }, []);

  const shoot = useCallback(() => {
    if (category === null || saving) return;
    setSaving(true);
    setProblem(null);
    setToast(null);
    void pipeline.capture({ workOrderId: orderId, category }).then((result) => {
      setSaving(false);
      setFree(media.freeDiskBytes());
      if (result.ok) {
        // the saves are one after another (the shutter waits for the previous one), so the rendered count is the current one
        AccessibilityInfo.announceForAccessibility(t('camera.savedA11y', { count: latest.current.count + 1 }));
        setCount((current) => current + 1);
        setToast((current) => ({ key: (current?.key ?? 0) + 1, message: t('camera.saved') }));
      } else if (result.code === 'no_space') setProblem('noSpace');
      else if (result.code !== 'busy') setProblem('saveFailed');
    });
  }, [category, saving, pipeline, orderId, media, t]);

  /** The end of a recording and of its save: the toast says how it ended; a failure leaves the queue and the counters as they were. */
  const videoDone = useCallback(
    (result: VideoResult): void => {
      recordingRef.current = null;
      setRecording(false);
      setStopping(false);
      setSavingVideo(false);
      setSeconds(0);
      media.keepScreenOn(false);
      setFree(media.freeDiskBytes());
      if (result.ok) {
        setVideoCount((current) => current + 1);
        say(t(VIDEO_END_KEY[result.end], { duration: formatDuration(result.durationMs) }));
      } else if (result.code === 'no_space') setProblem('videoNoSpace');
      else if (result.code === 'camera_failed' || result.code === 'save_failed') setProblem('videoSaveFailed');
    },
    [media, say, t],
  );

  const startRecording = useCallback(() => {
    if (category === null || saving || recordingRef.current !== null) return;
    setProblem(null);
    setToast(null);
    const started = pipeline.startVideo({ workOrderId: orderId, category });
    if (!started.ok) {
      setFree(media.freeDiskBytes());
      if (started.code === 'no_space') setProblem('videoNoSpace');
      else if (started.code !== 'busy' && started.code !== 'no_session') setProblem('videoSaveFailed');
      return;
    }
    const current = started.recording;
    recordingRef.current = current;
    setRecording(true);
    setSeconds(0);
    media.keepScreenOn(true);
    AccessibilityInfo.announceForAccessibility(t('camera.recordingStartedA11y'));
    void current.recorded.then(() => {
      if (recordingRef.current === current) {
        setSavingVideo(true);
        AccessibilityInfo.announceForAccessibility(t('camera.savingVideo'));
      }
    });
    void current.done.then(videoDone);
  }, [category, saving, pipeline, orderId, media, t, videoDone]);

  /** The technician (the shutter) or the app (the foreground was lost, back, the lock) ends the recording; the file is saved like any other film. */
  const stopRecording = useCallback((reason: 'user' | 'interrupted') => {
    if (recordingRef.current !== null) setStopping(true);
    recordingRef.current?.stop(reason);
  }, []);
  const stopRef = useRef(stopRecording);
  stopRef.current = stopRecording;
  loseForeground.current = () => {
    stopRef.current('interrupted');
  };

  // AC3: the foreground, the lock and the screen going away stop a recording (a toast for the screen that stays, the file is saved either way)
  useEffect(() => {
    if (!foreground || locked || !focused) stopRef.current('interrupted');
  }, [foreground, locked, focused]);
  useEffect(
    () => () => {
      stopRef.current('interrupted');
      media.keepScreenOn(false);
    },
    [media],
  );

  const finish = useCallback(() => {
    setFinishing(true);
    stopRef.current('interrupted');
    void pipeline.whenIdle().then(() => {
      const { taken: made, notifications, queued: waiting } = latest.current;
      if ((made > 0 || waiting) && notifications === 'denied' && !consentMemory.shown) {
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

  /** A change of the mode restarts the camera: the shutter waits for `onCameraReady` again (with a limit, so a camera that says nothing does not block it for good). */
  const changeMode = useCallback((next: Mode) => {
    setMode((current) => {
      if (current === next) return current;
      setCameraState('starting');
      return next;
    });
  }, []);
  useEffect(() => {
    if (cameraState !== 'starting') return undefined;
    const timer = setTimeout(() => {
      setCameraState((now) => (now === 'starting' ? 'ready' : now));
    }, MODE_RESTART_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [cameraState, mode]);

  // a film that took the free space below 200 MB leaves the film mode (the chip is off): the technician is back at the picture, which still works
  const roomForVideo = videoDiskLevel(free) !== 'blocked';
  useEffect(() => {
    if (!roomForVideo && mode === 'video' && !recording && !savingVideo) changeMode('photo');
  }, [roomForVideo, mode, recording, savingVideo, changeMode]);

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
  const noRoomForVideo = videoDiskLevel(free) === 'blocked';
  const video = mode === 'video';
  const needsCategory = category === null;
  const warn = recording && seconds >= VIDEO_WARN_AT_SECONDS;
  const notice =
    problem !== null || level !== 'ok' || needsCategory ? (
      <View style={{ rowGap: space.stack.sm }}>
        {problem !== null ? (
          <InlineAlert tone="error" body={t(PROBLEM_KEY[problem])} live="assertive" testID="camera-problem" />
        ) : level !== 'ok' && free !== null ? (
          <InlineAlert tone="warning" body={t('camera.lowSpace', { free: formatFreeSpace(free) })} testID="camera-low-space" />
        ) : null}
        {needsCategory ? (
          <Text style={{ ...text.body, color: color.text.onBrand }} testID="camera-choose-category">
            {t(video ? 'camera.chooseCategoryVideo' : 'camera.chooseCategory')}
          </Text>
        ) : null}
      </View>
    ) : undefined;
  const countKey = video
    ? pluralKey(videoCount, { one: 'camera.videoCount_one', few: 'camera.videoCount_few', many: 'camera.videoCount_many' })
    : pluralKey(count, { one: 'camera.count_one', few: 'camera.count_few', many: 'camera.count_many' });
  const shownCount = video ? videoCount : count;
  const busy = saving || savingVideo;
  const chipName = (label: string): string => (recording ? t('camera.unavailableWhileRecordingA11y', { name: label }) : label);
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.inverse }} testID="camera">
      <Bar orderId={orderId} onClose={finish} />
      <View style={{ flex: 1 }}>
        <CameraView
          key={attempt}
          ref={(node) => {
            cameraRef.current = node;
            if (node !== null) lastCameraRef.current = node;
          }}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          facing="back"
          mode={mode === 'video' ? 'video' : 'picture'}
          // EVM-110 (SEC-110-02): the view props of the film are one frozen constant, in EVERY mode - never a state, never a prop from outside
          {...VIDEO_VIEW_PROPS}
          onRecordingProgress={(event) => {
            recordingRef.current?.progress(event);
            const whole = Math.floor(event.duration);
            setSeconds(whole);
            if (whole >= VIDEO_WARN_AT_SECONDS && !warned.current) {
              warned.current = true;
              AccessibilityInfo.announceForAccessibility(t('camera.warnMinute'));
            }
          }}
          // the view stays active until the recording is over (EVM-110 AC3): a view switched off under a recording may lose the file
          active={(focused && foreground && !locked) || recording}
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
        {video ? (
          <View
            style={{
              position: 'absolute',
              top: space.inset.md,
              left: space.inset.md,
              right: space.inset.md,
              rowGap: space.stack.sm,
              alignItems: 'flex-start',
            }}
            pointerEvents="none"
          >
            <View style={{ ...overlayChip, flexDirection: 'row', alignItems: 'center', columnGap: space.inline.sm }} testID="camera-muted">
              <Icon icon={VolumeOff} color={color.icon.inverse} iconSize="md" />
              <Text style={{ ...text.body, color: color.text.inverse }}>{t('camera.muted')}</Text>
            </View>
            {recording ? (
              <View style={overlayChip}>
                <Text
                  accessibilityRole="timer"
                  accessibilityLabel={t('camera.timerA11y', { elapsed: formatDuration(seconds * 1000), max: MAX_CLOCK })}
                  accessibilityLiveRegion="none"
                  style={{ ...text.numeric, color: color.text.inverse }}
                  testID="camera-timer"
                >
                  {t('camera.timer', { elapsed: formatDuration(seconds * 1000), max: MAX_CLOCK })}
                </Text>
              </View>
            ) : null}
            {warn ? (
              // on the preview, under the counter: the panel does not grow while the camera records, so the shutter stays where the thumb is; the one announcement is the one of the progress
              <InlineAlert tone="warning" icon={TriangleAlert} body={t('camera.warnMinute')} live="none" testID="camera-warn-minute" />
            ) : null}
          </View>
        ) : null}
        {savingVideo ? (
          <View
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }}
            testID="camera-saving-video"
          >
            <Text style={{ ...text.body, color: color.text.inverse }}>{t('camera.savingVideo')}</Text>
          </View>
        ) : null}
        {toast !== null ? (
          <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} pointerEvents="none">
            <Toast
              key={toast.key}
              message={toast.message}
              onDismiss={dismissSaved}
              testID="camera-toast"
              {...(toast.spoken === true ? { announce: false, fullText: true } : {})}
            />
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
            accessibilityLabel={chipName(t(CATEGORY_KEY[item]))}
            selected={category === item}
            radio
            onDark
            disabled={recording}
            onPress={() => {
              setCategory(item);
            }}
            testID={`camera-category-${item}`}
          />
        ))}
        modesLabel={t('camera.modeGroup')}
        modes={
          <>
            <FilterChip
              label={t('camera.modePhoto')}
              accessibilityLabel={chipName(t('camera.modePhoto'))}
              selected={!video}
              radio
              onDark
              disabled={recording}
              onPress={() => {
                changeMode('photo');
              }}
              testID="camera-mode-photo"
            />
            <FilterChip
              label={t('camera.modeVideo')}
              accessibilityLabel={noRoomForVideo ? t('camera.modeVideoNoRoomA11y') : chipName(t('camera.modeVideo'))}
              selected={video}
              radio
              onDark
              disabled={recording || noRoomForVideo}
              onPress={() => {
                changeMode('video');
              }}
              testID="camera-mode-video"
            />
          </>
        }
        modesNote={
          noRoomForVideo ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: space.inline.sm }} testID="camera-video-no-room">
              <Icon icon={HardDrive} color={color.icon.inverse} iconSize="md" />
              <Text style={{ ...text.body, color: color.text.onBrand, flex: 1 }}>{t('camera.videoNoRoom')}</Text>
            </View>
          ) : undefined
        }
        counter={
          <Text style={{ ...text.body, color: color.text.onBrand }} testID="camera-count">
            {t(countKey, { count: shownCount })}
          </Text>
        }
        shutter={
          <CameraShutter
            accessibilityLabel={video ? (recording ? t('camera.recordStop') : t('camera.recordStart')) : t('camera.shutter')}
            accessibilityHint={
              needsCategory && !recording
                ? t(video ? 'camera.chooseCategoryVideo' : 'camera.chooseCategory')
                : video
                  ? t('camera.recordHint')
                  : t('camera.shutterHint')
            }
            disabled={recording ? stopping : needsCategory || busy || cameraState !== 'ready'}
            recording={recording}
            onPress={
              video
                ? () => {
                    if (recordingRef.current === null) {
                      warned.current = false;
                      startRecording();
                    } else stopRecording('user');
                  }
                : shoot
            }
            testID="camera-shutter"
          />
        }
        done={
          <Button
            label={t('camera.done')}
            accessibilityLabel={t('camera.doneA11y')}
            onPress={finish}
            busy={finishing || savingVideo}
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
