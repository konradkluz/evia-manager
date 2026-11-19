// The camera screen in the FILM mode (EVM-110 AC1, AC2, AC3, AC6, AC7): the switch, the recording, the counter, the limits, the interruptions.
// The film goes through the REAL `CapturePipeline` and `VideoRecording` on in-memory ports of a phone; `expo-camera` is the stand-in of test/mocks.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, BackHandler, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { CapturePorts } from '../../src/capture/capture-pipeline';
import { consentMemory } from '../../src/capture/camera-options';
import { VIDEO_BLOCK_BELOW_BYTES, VIDEO_STOP_BELOW_BYTES } from '../../src/capture/disk-space';
import { pl } from '../../src/i18n/pl';
import { CameraScreen } from '../../src/screens/CameraScreen';
import { LockGate } from '../../src/screens/LockOverlay';
import { SessionContext, type SessionActions } from '../../src/screens/session-context';
import { StartupProvider, type StartupChecker } from '../../src/startup';
import { EMPTY_COUNTS } from '../../src/sync/types';
import type { CapturedPhoto, CapturedVideo } from '../../src/upload/create-media-asset';
import { cameraMock } from '../mocks/expo-camera';
import { stubPorts, type PortsRig } from '../session-helpers';

jest.mock('expo-camera', () => jest.requireActual<typeof import('../mocks/expo-camera')>('../mocks/expo-camera'));
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
jest.mock('expo-status-bar', () => ({ StatusBar: jest.fn(() => null) }));

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const WO = '10000000-0000-4000-8000-000000000001';
const settle = () =>
  act(async () => {
    for (let n = 0; n < 16; n += 1) await Promise.resolve();
  });
const online: StartupChecker = () => Promise.resolve({ kind: 'online' });
const offline: StartupChecker = () => Promise.resolve({ kind: 'offline' });

function phone() {
  const state = {
    free: (10 * GB) as number | null,
    importResult: 'ok' as 'ok' | 'no_space' | 'io_error',
    registerOk: true,
    session: true,
  };
  const originals = new Set<string>();
  const videos: CapturedVideo[] = [];
  const photos: CapturedPhoto[] = [];
  const imports: string[] = [];
  let n = 0;
  const ports: Omit<CapturePorts, 'takePicture'> = {
    native: {
      importOriginal: (assetId, _uri, mediaType) => {
        imports.push(mediaType);
        if (state.importResult === 'ok') originals.add(assetId);
        return Promise.resolve(state.importResult);
      },
      digestOriginal: () => Promise.resolve({ sizeBytes: 78 * MB, sha256: 'a'.repeat(64) }),
      cancelUpload: (assetId) => {
        originals.delete(assetId);
        return Promise.resolve(true);
      },
    },
    disk: { freeBytes: () => state.free },
    registerAndEnqueue: (photo) => {
      photos.push(photo);
      return Promise.resolve({ ok: true });
    },
    registerVideo: (video) => {
      if (!state.registerOk) return Promise.resolve({ ok: false, code: 'enqueue_failed' });
      videos.push(video);
      return Promise.resolve({ ok: true });
    },
    sessionUser: () => (state.session ? 'user-a' : null),
    now: () => Date.UTC(2026, 10, 15, 8, 0, 0),
    newId: () => `0194c2a0-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`,
  };
  return { state, originals, videos, photos, imports, ports };
}

const actionsOf = (rig: PortsRig): SessionActions =>
  ({ media: rig.media, sync: rig.sync, guard: rig.device.guard }) as unknown as SessionActions;

async function mount(rig: PortsRig, props: { onClose?: () => void; checker?: StartupChecker } = {}) {
  const onClose = props.onClose ?? jest.fn();
  await act(async () => {
    await rig.device.guard.refresh();
    await rig.device.guard.unlock();
  });
  const view = await render(
    <SafeAreaProvider>
      <StartupProvider checker={props.checker ?? online}>
        <SessionContext.Provider value={actionsOf(rig)}>
          <CameraScreen orderId={WO} onClose={onClose} />
        </SessionContext.Provider>
      </StartupProvider>
    </SafeAreaProvider>,
  );
  await settle();
  return { onClose, view };
}

function setup(partial: Partial<ReturnType<typeof phone>['state']> = {}) {
  const rig = stubPorts();
  const p = phone();
  Object.assign(p.state, partial);
  rig.media.capturePorts = p.ports;
  rig.media.freeSource = () => p.state.free;
  return { rig, ...p };
}

/** Every listener of the changes of the state of the app gets the event, like the real one. */
function foregroundEvents(): (state: string) => void {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener as (state: string) => void);
    return { remove: () => undefined };
  });
  return (state) => {
    for (const listener of listeners) listener(state);
  };
}

const press = async (testID: string) => {
  await fireEvent.press(screen.getByTestId(testID));
  await settle();
};
const toVideo = async () => press('camera-mode-video');
const shutter = () => screen.getByTestId('camera-shutter');
const progress = async (duration: number, fileSize = 1000) => {
  await act(() => {
    cameraMock.progress(duration, fileSize);
  });
};
/** Category, the film mode and the start of a recording. */
async function startRecording(): Promise<void> {
  await toVideo();
  await press('camera-category-defect');
  await press('camera-shutter');
}
const count = (): string => String(screen.getByTestId('camera-count').props.children);

let announce: jest.SpyInstance;
beforeEach(() => {
  cameraMock.reset();
  consentMemory.shown = false;
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('the switch "Zdjęcie / Film" and the states of the film mode (EVM-110 AC6)', () => {
  it('EVM-110 AC6: two radio chips in a group "Tryb", "Zdjęcie" chosen at every opening, 48 dp targets, the marker "Film bez dźwięku" only in the film mode', async () => {
    const { rig } = setup();
    const first = await mount(rig);
    expect(screen.getByLabelText(pl.camera.modeGroup)).toHaveProp('accessibilityRole', 'radiogroup');
    expect(screen.getByRole('radio', { name: 'Zdjęcie' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Film' })).not.toBeChecked();
    expect(screen.queryByText('Film bez dźwięku')).toBeNull();
    expect(shutter()).toHaveProp('accessibilityLabel', 'Zrób zdjęcie');
    await toVideo();
    expect(screen.getByRole('radio', { name: 'Film' })).toBeChecked();
    expect(screen.getByText('Film bez dźwięku')).toBeOnTheScreen();
    expect(cameraMock.props).toMatchObject({ mode: 'video', mute: true });
    expect(shutter()).toHaveProp('accessibilityLabel', 'Rozpocznij nagrywanie');
    await press('camera-mode-photo');
    expect(cameraMock.props).toMatchObject({ mode: 'picture', mute: true });
    expect(screen.queryByText('Film bez dźwięku')).toBeNull();
    await toVideo();
    await first.view.unmount();
    // a new opening starts in the picture mode again
    await mount(rig);
    expect(screen.getByRole('radio', { name: 'Zdjęcie' })).toBeChecked();
    expect(cameraMock.props).toMatchObject({ mode: 'picture' });
  });

  it('EVM-110 AC6: the category is common to both modes; the first film of the order needs one (visible and spoken hint), the next ones take the last', async () => {
    const { rig, videos } = setup();
    await mount(rig);
    await press('camera-category-measurement');
    await toVideo();
    expect(screen.getByRole('radio', { name: 'Pomiary' })).toBeChecked();
    expect(screen.queryByText(pl.camera.chooseCategoryVideo)).toBeNull();
    await press('camera-shutter');
    await press('camera-shutter');
    expect(videos.map((video) => video.category)).toEqual(['measurement']);
    await press('camera-category-defect');
    await press('camera-shutter');
    await press('camera-shutter');
    expect(videos.map((video) => video.category)).toEqual(['measurement', 'defect']);
    // a fresh opening without a category says why the shutter does nothing
    const { rig: fresh } = setup();
    await mount(fresh);
    await toVideo();
    expect(screen.getByText(pl.camera.chooseCategoryVideo)).toBeOnTheScreen();
    expect(shutter()).toBeDisabled();
    expect(shutter()).toHaveProp('accessibilityHint', pl.camera.chooseCategoryVideo);
  });

  it('EVM-110 AC2: below 200 MB the chip "Film" is off with the icon, the visible reason and the spoken one - and pictures still work', async () => {
    const { rig, photos } = setup({ free: VIDEO_BLOCK_BELOW_BYTES - 1 });
    await mount(rig);
    const chip = screen.getByTestId('camera-mode-video');
    expect(chip).toBeDisabled();
    expect(chip).toHaveProp('accessibilityLabel', 'Film, niedostępny — za mało miejsca na film');
    expect(screen.getByText('Za mało miejsca na film. Zwolnij miejsce w telefonie.')).toBeOnTheScreen();
    expect(screen.getByTestId('camera-video-no-room')).toBeOnTheScreen();
    await fireEvent.press(chip);
    expect(screen.getByRole('radio', { name: 'Zdjęcie' })).toBeChecked();
    await press('camera-category-other');
    await press('camera-shutter');
    expect(photos).toHaveLength(1);
  });

  it('EVM-110 AC6: 200 MB exactly leaves the film on, and the reason is not shown', async () => {
    const { rig } = setup({ free: VIDEO_BLOCK_BELOW_BYTES });
    await mount(rig);
    expect(screen.getByTestId('camera-mode-video')).toBeEnabled();
    expect(screen.queryByTestId('camera-video-no-room')).toBeNull();
  });

  it('EVM-110 AC7: the app never asks for the microphone - not for the film, not for the picture', async () => {
    const { rig } = setup();
    await mount(rig);
    await startRecording();
    await press('camera-shutter');
    expect(cameraMock.forbidden).not.toHaveBeenCalled();
    expect(cameraMock.props).toMatchObject({ mute: true, videoQuality: '720p', videoBitrate: 5_000_000 });
  });
});

describe('a recording from start to the toast (EVM-110 AC1, AC2)', () => {
  it('EVM-110 AC1 AC2: the start keeps the screen on, shows the counter "0:42 / 5:00" (role timer), switches the shutter to "stop" and locks the chips; the end saves the film', async () => {
    const { rig, videos, imports } = setup();
    await mount(rig);
    await startRecording();
    expect(cameraMock.recordOptions).toEqual([{ maxDuration: 300, maxFileSize: 500_000_000 }]);
    expect(rig.media.keepAwake).toEqual([true]);
    expect(announce).toHaveBeenCalledWith(pl.camera.recordingStartedA11y);
    expect(shutter()).toHaveProp('accessibilityLabel', 'Zatrzymaj nagrywanie');
    expect(shutter()).toBeEnabled();
    await progress(42);
    const timer = screen.getByTestId('camera-timer');
    expect(timer).toHaveProp('accessibilityRole', 'timer');
    expect(screen.getByText('0:42 / 5:00')).toBeOnTheScreen();
    // the chips of the categories and of the mode are off while the camera records, with the spoken reason
    expect(screen.getByTestId('camera-category-defect')).toBeDisabled();
    expect(screen.getByTestId('camera-category-defect')).toHaveProp(
      'accessibilityLabel',
      'Usterka / problem, niedostępne podczas nagrywania',
    );
    expect(screen.getByTestId('camera-mode-photo')).toBeDisabled();
    expect(screen.getByTestId('camera-mode-video')).toBeDisabled();
    expect(count()).toBe('0 filmów');
    expect(videos).toEqual([]);
    await progress(133, 50 * MB);
    await press('camera-shutter');
    expect(cameraMock.stopCalls).toBe(1);
    expect(imports).toEqual(['video']);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ workOrderId: WO, category: 'defect', durationMs: 133_000 });
    expect(rig.media.keepAwake).toEqual([true, false]);
    expect(screen.getByText('Zapisano film w telefonie')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('Zapisano film w telefonie');
    expect(count()).toBe('1 film');
    expect(screen.queryByTestId('camera-timer')).toBeNull();
    expect(screen.getByTestId('camera-category-defect')).toBeEnabled();
    expect(shutter()).toHaveProp('accessibilityLabel', 'Rozpocznij nagrywanie');
  });

  it('EVM-110 AC2: the counter of the series speaks "1 film / 2 filmy / 5 filmów" and the pictures keep their own', async () => {
    const { rig } = setup();
    await mount(rig);
    await toVideo();
    await press('camera-category-defect');
    for (let n = 0; n < 5; n += 1) {
      await press('camera-shutter');
      await press('camera-shutter');
      expect(count()).toBe(['1 film', '2 filmy', '3 filmy', '4 filmy', '5 filmów'][n]);
    }
    await press('camera-mode-photo');
    expect(count()).toBe('0 zdjęć');
  });

  it('EVM-110 AC2: the announcements are the start, the last minute and the end - the seconds in between are silent', async () => {
    const { rig } = setup();
    await mount(rig);
    await startRecording();
    announce.mockClear();
    for (const second of [1, 2, 59, 120, 239]) await progress(second);
    expect(announce).not.toHaveBeenCalled();
    expect(screen.queryByTestId('camera-warn-minute')).toBeNull();
    await progress(240);
    await progress(241);
    expect(announce.mock.calls.filter(([text]) => text === pl.camera.warnMinute)).toHaveLength(1);
    expect(screen.getByText('Za minutę koniec nagrania (limit 5 minut).')).toBeOnTheScreen();
    expect(screen.getByTestId('camera-warn-minute')).toBeOnTheScreen();
    await press('camera-shutter');
    expect(announce).toHaveBeenCalledWith('Zapisano film w telefonie');
  });

  it('EVM-110 AC2: after 5 minutes the film ends by itself and is saved with the message of the limit', async () => {
    const { rig, videos } = setup();
    await mount(rig);
    await startRecording();
    await progress(299.5, 190 * MB);
    // the library resolves the recording at the limit - nobody pressed anything
    await act(() => {
      cameraMock.finishRecording();
    });
    await settle();
    expect(cameraMock.stopCalls).toBe(0);
    expect(videos).toHaveLength(1);
    expect(screen.getByText('Osiągnięto limit 5 minut — film zapisano.')).toBeOnTheScreen();
  });

  it('EVM-110 AC2: the safety limit of the size and the lack of space end the film with their own words, and the film is saved', async () => {
    const size = setup();
    await mount(size.rig);
    await startRecording();
    await progress(100, 500_000_000);
    await act(() => {
      cameraMock.finishRecording();
    });
    await settle();
    expect(size.videos).toHaveLength(1);
    expect(screen.getByText('Osiągnięto limit rozmiaru — film zapisano.')).toBeOnTheScreen();
    await screen.unmount();

    const space = setup();
    await mount(space.rig);
    await startRecording();
    space.state.free = VIDEO_STOP_BELOW_BYTES - 1;
    await progress(30, 10 * MB);
    expect(cameraMock.stopCalls).toBe(1);
    await settle();
    expect(space.videos).toHaveLength(1);
    expect(screen.getByText('Brak miejsca — nagranie zatrzymano i zapisano.')).toBeOnTheScreen();
  });

  it('EVM-110 AC2: a film that cannot be saved says so in words and leaves the counter and the queue as they were - no half film, no row without a file', async () => {
    const words = 'Nie udało się zapisać filmu. Nagraj go ponownie.';
    const noRoom = 'Za mało miejsca na film. Zwolnij miejsce w telefonie.';
    for (const [fault, message] of [
      [{ importResult: 'io_error' as const }, words],
      [{ registerOk: false }, words],
      [{ importResult: 'no_space' as const }, noRoom],
    ] as const) {
      const { rig, videos, originals } = setup(fault);
      const { view } = await mount(rig);
      await startRecording();
      await press('camera-shutter');
      expect(screen.getByText(message)).toBeOnTheScreen();
      expect(screen.getByTestId('camera-problem')).toBeOnTheScreen();
      expect(count()).toBe('0 filmów');
      expect(videos).toEqual([]);
      expect([...originals]).toEqual([]);
      expect(rig.media.keepAwake.at(-1)).toBe(false);
      await view.unmount();
    }
  });

  it('EVM-110 AC2: a recorder that fails ends the recording with the message, releases the screen and allows a new recording', async () => {
    const { rig, videos } = setup();
    await mount(rig);
    await startRecording();
    await act(() => {
      cameraMock.recordings.at(-1)?.reject(new Error('synthetic'));
    });
    await settle();
    expect(screen.getByText('Nie udało się zapisać filmu. Nagraj go ponownie.')).toBeOnTheScreen();
    expect(rig.media.keepAwake).toEqual([true, false]);
    await press('camera-shutter');
    await press('camera-shutter');
    expect(videos).toHaveLength(1);
    expect(screen.queryByTestId('camera-problem')).toBeNull();
  });

  it('EVM-110 AC2: with 200 MB or less at the start nothing is recorded; the chip and the text are there and the camera was never asked', async () => {
    const { rig, state } = setup();
    await mount(rig);
    await toVideo();
    await press('camera-category-defect');
    // the phone fills up between the chip and the shutter
    state.free = VIDEO_BLOCK_BELOW_BYTES - 5;
    await press('camera-shutter');
    expect(cameraMock.recordOptions).toEqual([]);
    expect(rig.media.keepAwake).toEqual([]);
  });
});

describe('interruptions (EVM-110 AC3)', () => {
  it('EVM-110 AC3: losing the foreground stops the recording, the film is saved and the message tells its length (2:13)', async () => {
    const emit = foregroundEvents();
    const { rig, videos } = setup();
    await mount(rig);
    await startRecording();
    await progress(133.4, 40 * MB);
    await act(() => {
      emit('background');
    });
    await settle();
    expect(cameraMock.stopCalls).toBeGreaterThanOrEqual(1);
    expect(videos).toHaveLength(1);
    expect(videos[0]?.durationMs).toBe(133_400);
    expect(screen.getByText('Nagrywanie przerwane — zapisano 2:13 filmu.')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('Nagrywanie przerwane — zapisano 2:13 filmu.');
    expect(rig.media.keepAwake.at(-1)).toBe(false);
  });

  it('EVM-110 AC3: the system "back" and "Zamknij" stop the recording, wait for the save and only then return to the order - without a dialog', async () => {
    const handlers: (() => unknown)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_name, handler) => {
      handlers.push(handler as () => unknown);
      return { remove: () => undefined };
    });
    const { rig, videos } = setup();
    const { onClose } = await mount(rig);
    await startRecording();
    await progress(20, 6 * MB);
    expect(handlers.at(-1)?.()).toBe(true);
    await settle();
    expect(videos).toHaveLength(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(rig.media.keepAwake.at(-1)).toBe(false);
  });

  it('EVM-110 AC3: "Zamknij" (the cross) does the same as "back"; "Gotowe" too', async () => {
    const { rig, videos } = setup();
    const { onClose } = await mount(rig);
    await startRecording();
    await progress(20, 6 * MB);
    await press('camera-close');
    expect(videos).toHaveLength(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    await screen.unmount();
    const other = setup();
    const second = await mount(other.rig);
    await startRecording();
    await progress(20, 6 * MB);
    await press('camera-done');
    expect(other.videos).toHaveLength(1);
    expect(second.onClose).toHaveBeenCalledTimes(1);
  });

  it('EVM-110 AC3: the screen going away stops the recording and takes the flag of the screen off', async () => {
    const { rig, videos } = setup();
    const { view } = await mount(rig);
    await startRecording();
    await view.unmount();
    await settle();
    expect(cameraMock.stopCalls).toBeGreaterThanOrEqual(1);
    expect(rig.media.keepAwake.at(-1)).toBe(false);
    expect(videos).toHaveLength(1);
  });

  it('EVM-110 AC3 SEC-110-12: the owner of the session can stop the recording by `stopRecording` before it cleans - the screen needs no part in it', async () => {
    const { rig, videos } = setup();
    await mount(rig);
    await startRecording();
    await progress(55, 16 * MB);
    await act(async () => {
      await rig.media.stopRecording();
    });
    await settle();
    expect(rig.media.stopCalls).toEqual([3000]);
    expect(videos).toHaveLength(1);
  });

  it('EVM-110 AC3 SEC-110-12: a film finishing after the session ended is not imported and no message of success is shown', async () => {
    const { rig, videos, imports, state } = setup();
    await mount(rig);
    await startRecording();
    state.session = false;
    await press('camera-shutter');
    expect(imports).toEqual([]);
    expect(videos).toEqual([]);
    expect(screen.queryByText('Zapisano film w telefonie')).toBeNull();
    expect(count()).toBe('0 filmów');
  });
});

describe('roles and states of the app around the film (EVM-110 AC6)', () => {
  it('EVM-110 AC6: offline the film is recorded and saved as online - the capsule says "Offline · n" and no banner of the missing network covers the preview', async () => {
    const { rig, videos } = setup();
    rig.sync.set({ online: false, counts: { ...EMPTY_COUNTS, pending: 2, unsent: 2 } });
    await mount(rig, { checker: offline });
    expect(screen.getByTestId('sync-indicator')).toHaveTextContent('Offline · 2');
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    expect(screen.queryByText(/Brak zasięgu/)).toBeNull();
    await startRecording();
    await progress(7, 2 * MB);
    expect(screen.getByTestId('sync-indicator')).toHaveTextContent('Offline · 2');
    expect(screen.queryByText(/Brak zasięgu/)).toBeNull();
    await press('camera-shutter');
    expect(videos).toHaveLength(1);
    expect(screen.getByText('Zapisano film w telefonie')).toBeOnTheScreen();
  });

  it('EVM-110 AC6: in the hidden-data mode the film is recorded, the bar says "Aparat" and no number or title of an order is read or drawn', async () => {
    const { rig, videos } = setup();
    rig.device.facts.secure = false;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    const asked = jest.spyOn(rig.sync, 'orderList');
    await mount(rig);
    expect(asked).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Aparat' })).toBeOnTheScreen();
    await startRecording();
    await progress(12, 3 * MB);
    await press('camera-shutter');
    expect(videos).toHaveLength(1);
    expect(screen.getByText('Zapisano film w telefonie')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/ZL-|10000000-0000-4000/);
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('the view, the lock and the layout during a recording (EVM-110 AC3, AC6; review round 1)', () => {
  const active = (): unknown => cameraMock.props?.['active'];

  it('EVM-110 AC3: the view stays ACTIVE until the film is saved - losing the foreground asks for the stop in the same turn, the view is switched off only afterwards', async () => {
    const emit = foregroundEvents();
    const { rig, videos } = setup();
    await mount(rig);
    await startRecording();
    // the library ends the file a moment later than the request (it does not end it by the stop alone in this test)
    cameraMock.endsOnStop = false;
    await progress(20, 6 * MB);
    await act(() => {
      emit('background');
    });
    // asked in the same turn as the loss (and, idempotently, again by the effect that follows it)
    expect(cameraMock.stopCalls).toBeGreaterThanOrEqual(1);
    expect(active()).toBe(true);
    await act(() => {
      cameraMock.finishRecording();
    });
    await settle();
    expect(videos).toHaveLength(1);
    expect(active()).toBe(false);
  });

  it('EVM-110 AC3: the lock of the app during a recording stops it, the film is saved, and only then the view is released (active = false)', async () => {
    const { rig, videos } = setup();
    await mount(rig);
    await startRecording();
    await progress(33, 9 * MB);
    expect(active()).toBe(true);
    await act(() => {
      rig.device.guard.signedOut();
    });
    await settle();
    expect(cameraMock.stopCalls).toBeGreaterThanOrEqual(1);
    expect(videos).toHaveLength(1);
    expect(videos[0]?.durationMs).toBe(33_000);
    expect(active()).toBe(false);
    expect(rig.media.keepAwake.at(-1)).toBe(false);
  });

  it('EVM-146 AC3: the lock that hides the screen under the cover (Activity hidden) during a recording stops it - the film is saved, not lost, and the view is released', async () => {
    const { rig, videos } = setup();
    await act(async () => {
      await rig.device.guard.refresh();
      await rig.device.guard.unlock();
    });
    const tree = (locked: boolean) => (
      <SafeAreaProvider>
        <StartupProvider checker={online}>
          <SessionContext.Provider value={actionsOf(rig)}>
            <LockGate locked={locked} prompting={false} failed={false} appState={rig.device.guard.appState} onUnlock={() => undefined}>
              <CameraScreen orderId={WO} onClose={jest.fn()} />
            </LockGate>
          </SessionContext.Provider>
        </StartupProvider>
      </SafeAreaProvider>
    );
    const view = await render(tree(false));
    await settle();
    await startRecording();
    await progress(33, 9 * MB);
    await act(() => {
      rig.device.guard.signedOut(); // the guard is locked ...
    });
    await view.rerender(tree(true)); // ... and the content goes under the cover
    await settle();
    expect(cameraMock.stopCalls).toBeGreaterThanOrEqual(1);
    expect(videos).toHaveLength(1);
    expect(videos[0]?.durationMs).toBe(33_000);
    expect(rig.media.keepAwake.at(-1)).toBe(false);
  });

  it('EVM-146 AC3: the lock during a recording does not unbind the camera (the unbinding could cut the file): the film is saved and the camera stays bound until the unlock', async () => {
    const { rig, videos } = setup();
    await act(async () => {
      await rig.device.guard.refresh();
      await rig.device.guard.unlock();
    });
    const tree = (locked: boolean) => (
      <SafeAreaProvider>
        <StartupProvider checker={online}>
          <SessionContext.Provider value={actionsOf(rig)}>
            <LockGate locked={locked} prompting={false} failed={false} appState={rig.device.guard.appState} onUnlock={() => undefined}>
              <CameraScreen orderId={WO} onClose={jest.fn()} />
            </LockGate>
          </SessionContext.Provider>
        </StartupProvider>
      </SafeAreaProvider>
    );
    const view = await render(tree(false));
    await settle();
    await startRecording();
    await progress(33, 9 * MB);
    cameraMock.endsOnStop = false; // the library takes its time to finish the file
    await view.rerender(tree(true));
    await settle();
    expect(cameraMock.stopCalls).toBeGreaterThanOrEqual(1);
    await act(() => {
      cameraMock.finishRecording();
    });
    await settle();
    expect(videos).toHaveLength(1);
    expect(cameraMock.pauses).toBe(0);
    await view.rerender(tree(false));
    await settle();
    expect(cameraMock.resumes).toBe(0); // it was never paused
  });

  it('EVM-110 AC2: a second press of the shutter while the stop is under way does nothing more - no second stop', async () => {
    const { rig } = setup();
    await mount(rig);
    await startRecording();
    cameraMock.endsOnStop = false;
    await press('camera-shutter');
    expect(cameraMock.stopCalls).toBe(1);
    expect(shutter()).toBeDisabled();
    await fireEvent.press(shutter());
    expect(cameraMock.stopCalls).toBe(1);
    await act(() => {
      cameraMock.finishRecording();
    });
    await settle();
    expect(shutter()).toBeEnabled();
  });

  it('EVM-110 AC2: the warning of the last minute is on the PREVIEW, not in the panel - the panel does not grow, the shutter stays where the thumb is - and it is announced once', async () => {
    const { rig } = setup();
    await mount(rig);
    await startRecording();
    announce.mockClear();
    await progress(240);
    await progress(250);
    const warning = screen.getByTestId('camera-warn-minute');
    expect(warning).toHaveProp('accessibilityLiveRegion', 'none');
    expect(announce.mock.calls.filter(([text]) => text === pl.camera.warnMinute)).toHaveLength(1);
    // it sits in the overlay of the preview, next to the counter - not in the panel with the chips and the shutter
    expect(warning.parent).toBe(screen.getByTestId('camera-timer').parent?.parent);
  });

  it('EVM-110 AC6: the marker "Film bez dźwięku" and the counter sit on a dark chip of their own (readable on any preview)', async () => {
    const { rig } = setup();
    await mount(rig);
    await startRecording();
    const chip = screen.getByTestId('camera-muted');
    const timerChip = screen.getByTestId('camera-timer').parent;
    const bg = (node: { props: { style?: unknown } } | null | undefined): unknown =>
      (StyleSheet.flatten(node?.props.style as never) as { backgroundColor?: unknown } | undefined)?.backgroundColor;
    expect(bg(chip)).toBe(bg(timerChip));
    expect(bg(chip)).toBeTruthy();
  });

  it('EVM-110 AC2: the messages of the end of a recording are shown whole - no limit of lines, no second announcement from the toast', async () => {
    const { rig } = setup();
    await mount(rig);
    await startRecording();
    await progress(133.4, 40 * MB);
    announce.mockClear();
    await press('camera-shutter');
    const toast = screen.getByTestId('camera-toast');
    expect(toast).toHaveProp('accessibilityLiveRegion', 'none');
    expect(toast.props.accessibilityRole).toBeUndefined();
    expect(screen.getByText('Zapisano film w telefonie').props.numberOfLines).toBeUndefined();
    // spoken once, by the screen
    expect(announce.mock.calls.filter(([text]) => text === 'Zapisano film w telefonie')).toHaveLength(1);
  });

  it('EVM-110 AC2: a film that took the free space below 200 MB leaves the film mode - the picture is chosen, the chip says why it is off', async () => {
    const { rig, state } = setup();
    await mount(rig);
    await startRecording();
    await progress(10, 3 * MB);
    state.free = VIDEO_BLOCK_BELOW_BYTES - 10 * MB;
    await press('camera-shutter');
    expect(screen.getByRole('radio', { name: 'Zdjęcie' })).toBeChecked();
    expect(screen.getByTestId('camera-mode-video')).toBeDisabled();
    expect(screen.getByTestId('camera-video-no-room')).toBeOnTheScreen();
    expect(cameraMock.props).toMatchObject({ mode: 'picture' });
  });

  it('EVM-110 AC6: the camera restarts for another mode - the shutter waits for the camera to be ready again, and a camera that stays silent does not block it for good', async () => {
    jest.useFakeTimers();
    try {
      const { rig } = setup();
      await mount(rig);
      await press('camera-category-defect');
      cameraMock.readyOnRestart = false;
      await press('camera-mode-video');
      expect(screen.getByTestId('camera-loading')).toBeOnTheScreen();
      expect(shutter()).toBeDisabled();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(6100);
      });
      expect(screen.queryByTestId('camera-loading')).toBeNull();
      expect(shutter()).toBeEnabled();
    } finally {
      jest.useRealTimers();
    }
  });
});
