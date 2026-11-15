// The camera screen (EVM-108 AC1-AC4): the series and the return to the order, the permission, the lack of space and the errors of the camera.
// The photo itself goes through the REAL `CapturePipeline` on in-memory ports of a phone; the library `expo-camera` is the stand-in of test/mocks.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, BackHandler, Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { App } from '../../src/App';
import type { CapturePorts } from '../../src/capture/capture-pipeline';
import { consentMemory } from '../../src/capture/camera-options';
import { BLOCK_BELOW_BYTES } from '../../src/capture/disk-space';
import { pl } from '../../src/i18n/pl';
import { buildOrderList } from '../../src/orders/order-list-model';
import { CameraScreen } from '../../src/screens/CameraScreen';
import { SessionContext, type SessionActions } from '../../src/screens/session-context';
import { StartupProvider, type StartupChecker } from '../../src/startup';
import type { CapturedPhoto } from '../../src/upload/create-media-asset';
import type { MediaUploadsSnapshot } from '../../src/upload/types';
import { BLOCKED, DENIED, GRANTED, UNDETERMINED, cameraMock } from '../mocks/expo-camera';
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

const GB = 1024 ** 3;
const WO = '10000000-0000-4000-8000-000000000001';
const settle = () =>
  act(async () => {
    for (let n = 0; n < 12; n += 1) await Promise.resolve();
  });
const online: StartupChecker = () => Promise.resolve({ kind: 'online' });

/** The ports of a phone in memory: what the native module and the queue would hold, with the faults the tests switch on. */
function phone() {
  const state = {
    free: (10 * GB) as number | null,
    importResult: 'ok' as 'ok' | 'no_space' | 'io_error',
    registerOk: true,
    gate: null as Promise<void> | null,
    digest: { sizeBytes: 250_000, sha256: 'a'.repeat(64) } as { sizeBytes: number; sha256: string } | null,
  };
  const originals = new Set<string>();
  const photos: CapturedPhoto[] = [];
  let n = 0;
  const ports: Omit<CapturePorts, 'takePicture'> = {
    native: {
      importOriginal: (assetId) => {
        if (state.importResult === 'ok') originals.add(assetId);
        return Promise.resolve(state.importResult);
      },
      digestOriginal: () => Promise.resolve(state.digest),
      cancelUpload: (assetId) => {
        originals.delete(assetId);
        return Promise.resolve(true);
      },
    },
    disk: { freeBytes: () => state.free },
    registerAndEnqueue: async (photo) => {
      await state.gate;
      if (!state.registerOk) return { ok: false, code: 'enqueue_failed' };
      photos.push(photo);
      return { ok: true };
    },
    now: () => Date.UTC(2026, 10, 15, 8, 0, 0),
    newId: () => `0194c2a0-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`,
  };
  return { state, originals, photos, ports };
}

const actionsOf = (rig: PortsRig): SessionActions =>
  ({ media: rig.media, sync: rig.sync, guard: rig.device.guard }) as unknown as SessionActions;

/** The camera screen alone, inside the contexts it needs (the capsule of the synchronization reads the startup state). */
async function mount(rig: PortsRig, props: { onClose?: () => void; focused?: boolean; locked?: boolean } = {}) {
  const onClose = props.onClose ?? jest.fn();
  // the screen sits under the app lock in the real app: the device check ran (no hidden-data mode unless the test made one) and the lock is open
  await act(async () => {
    await rig.device.guard.refresh();
    if (props.locked !== true) await rig.device.guard.unlock();
  });
  await render(
    <SafeAreaProvider>
      <StartupProvider checker={online}>
        <SessionContext.Provider value={actionsOf(rig)}>
          <CameraScreen orderId={WO} onClose={onClose} {...(props.focused === undefined ? {} : { focused: props.focused })} />
        </SessionContext.Provider>
      </StartupProvider>
    </SafeAreaProvider>,
  );
  await settle();
  return onClose;
}

function setup(partial: Partial<ReturnType<typeof phone>['state']> = {}) {
  const rig = stubPorts();
  const p = phone();
  Object.assign(p.state, partial);
  rig.media.capturePorts = p.ports;
  rig.media.freeSource = () => p.state.free;
  return { rig, ...p };
}

/** Every listener of the changes of the state of the app (the screen, the permission, the startup check) gets the event, like the real one. */
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
const choose = async (category: string) => {
  await fireEvent.press(screen.getByTestId(`camera-category-${category}`));
};
const shoot = async () => {
  await fireEvent.press(screen.getByTestId('camera-shutter'));
  await settle();
};
const count = (): string => String(screen.getByTestId('camera-count').props.children);
const shutter = () => screen.getByTestId('camera-shutter');

let announce: jest.SpyInstance;
beforeEach(() => {
  cameraMock.reset();
  consentMemory.shown = false;
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('a series of photos and the return to the order (EVM-108 AC2)', () => {
  it('EVM-108 AC2: the first photo needs a category - the shutter is blocked with the visible and the spoken hint, and takes no picture', async () => {
    const { rig } = setup();
    await mount(rig);
    expect(screen.getByText(pl.camera.chooseCategory)).toBeOnTheScreen();
    expect(shutter()).toHaveProp('accessibilityHint', pl.camera.chooseCategory);
    expect(shutter()).toBeDisabled();
    await fireEvent.press(shutter());
    expect(cameraMock.takePictureAsync).not.toHaveBeenCalled();
    await choose('defect');
    expect(screen.queryByText(pl.camera.chooseCategory)).toBeNull();
    expect(shutter()).toBeEnabled();
  });

  it('EVM-108 AC2: all 7 categories of the contract are chips of one radio group with the texts of the story', async () => {
    const { rig } = setup();
    await mount(rig);
    const labels = [...Object.values(pl.camera.categories)];
    expect(labels).toEqual(['Oględziny', 'Stan przed pracami', 'W trakcie prac', 'Po zakończeniu', 'Usterka / problem', 'Pomiary', 'Inne']);
    for (const label of labels) expect(screen.getByRole('radio', { name: label })).toBeOnTheScreen();
    expect(screen.getByLabelText(pl.camera.categoryGroup)).toHaveProp('accessibilityRole', 'radiogroup');
    await choose('measurement');
    expect(screen.getByRole('radio', { name: 'Pomiary' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Inne' })).not.toBeChecked();
  });

  it('EVM-108 AC2: the counter, the toast and the announcement come only AFTER the durable save (a delayed save keeps the counter at 0)', async () => {
    let release: () => void = () => undefined;
    const { rig, photos } = setup({ gate: new Promise<void>((resolve) => (release = resolve)) });
    await mount(rig);
    await choose('site_survey');
    expect(count()).toBe('0 zdjęć');
    await shoot();
    // the picture was taken and is being saved: nothing is promised yet
    expect(cameraMock.takePictureAsync).toHaveBeenCalledTimes(1);
    expect(count()).toBe('0 zdjęć');
    expect(screen.queryByText(pl.camera.saved)).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    await act(() => {
      release();
    });
    await settle();
    expect(photos).toHaveLength(1);
    expect(count()).toBe('1 zdjęcie');
    expect(screen.getByText('Zapisano w telefonie')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('Zapisano zdjęcie 1');
  });

  it('EVM-108 AC2: the next shots take the last category chosen; a new choice applies from the next shot; 20 shots have 20 different ids', async () => {
    const { rig, photos } = setup();
    await mount(rig);
    await choose('before_work');
    await shoot();
    await shoot();
    await choose('completed_work');
    await shoot();
    expect(photos.map((photo) => photo.category)).toEqual(['before_work', 'before_work', 'completed_work']);
    for (let i = 0; i < 17; i += 1) await shoot();
    expect(photos).toHaveLength(20);
    expect(new Set(photos.map((photo) => photo.assetId)).size).toBe(20);
    expect(photos.every((photo) => photo.workOrderId === WO)).toBe(true);
    expect(count()).toBe('20 zdjęć');
    expect(announce).toHaveBeenLastCalledWith('Zapisano zdjęcie 20');
  });

  it.each([
    [1, '1 zdjęcie'],
    [2, '2 zdjęcia'],
    [5, '5 zdjęć'],
  ])('EVM-108 AC2: the counter of %i shots reads "%s"', async (shots, text) => {
    const { rig } = setup();
    await mount(rig);
    await choose('other');
    for (let i = 0; i < shots; i += 1) await shoot();
    expect(count()).toBe(text);
  });

  it('EVM-108 AC2: the camera of the phone is asked for ONE picture with the constant options and the shutter waits for the save in progress', async () => {
    let release: () => void = () => undefined;
    const { rig, photos } = setup({ gate: new Promise<void>((resolve) => (release = resolve)) });
    await mount(rig);
    await choose('other');
    await shoot();
    expect(shutter()).toBeDisabled();
    await fireEvent.press(shutter());
    expect(cameraMock.takePictureAsync).toHaveBeenCalledTimes(1);
    expect(cameraMock.takePictureAsync).toHaveBeenCalledWith({ quality: 0.9 });
    await act(() => {
      release();
    });
    await settle();
    expect(photos).toHaveLength(1);
    expect(shutter()).toBeEnabled();
  });

  it('EVM-108 AC2: "Gotowe" without a photo returns to the order at once, with no consent sheet', async () => {
    const { rig } = setup();
    rig.media.set({ files: [], notifications: 'denied' });
    const onClose = await mount(rig);
    await fireEvent.press(screen.getByTestId('camera-done'));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('notification-consent')).toBeNull();
  });

  it('EVM-108 AC2: "Gotowe" waits for a save in progress, then returns to the order', async () => {
    let release: () => void = () => undefined;
    const { rig } = setup({ gate: new Promise<void>((resolve) => (release = resolve)) });
    const onClose = await mount(rig);
    await choose('other');
    await shoot();
    await fireEvent.press(screen.getByTestId('camera-done'));
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('camera-done')).toHaveProp('accessibilityState', expect.objectContaining({ busy: true }));
    await act(() => {
      release();
    });
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('EVM-108 AC2: the system "back" does what "Gotowe" does, and "Zamknij" too', async () => {
    const { rig } = setup();
    const handlers: (() => unknown)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_name, handler) => {
      handlers.push(handler as () => unknown);
      return { remove: () => undefined };
    });
    const onClose = await mount(rig);
    expect(handlers.at(-1)?.()).toBe(true);
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('camera-close'));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('EVM-108 AC2: after the first "Gotowe" with a photo in the queue and notifications off the app asks ("Powiadomienia o wysyłaniu"); the answer "Włącz powiadomienia" asks the system and returns', async () => {
    const { rig } = setup();
    rig.media.set({ files: [], notifications: 'denied' });
    const onClose = await mount(rig);
    await choose('other');
    await shoot();
    await fireEvent.press(screen.getByTestId('camera-done'));
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Powiadomienia o wysyłaniu')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Włącz powiadomienia' }));
    await settle();
    expect(rig.media.calls).toContain('requestNotifications');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('EVM-108 AC2: a refusal never blocks the work - "Nie teraz" returns to the order; the sheet is shown once per process, not at the next "Gotowe"', async () => {
    const { rig } = setup();
    rig.media.set({ files: [], notifications: 'denied' });
    const onClose = await mount(rig);
    await choose('other');
    await shoot();
    await fireEvent.press(screen.getByTestId('camera-done'));
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'Nie teraz' }));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(rig.media.calls).not.toContain('requestNotifications');
    // the second opening of the camera in the same process
    await screen.unmount();
    await mount(rig, { onClose });
    await choose('other');
    await shoot();
    await fireEvent.press(screen.getByTestId('camera-done'));
    await settle();
    expect(screen.queryByTestId('notification-consent')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('EVM-108 AC2: with the notifications on there is no sheet; a file already waiting in the queue counts as "an element in the queue"', async () => {
    const granted = setup();
    const onClose = await mount(granted.rig);
    await choose('other');
    await shoot();
    await fireEvent.press(screen.getByTestId('camera-done'));
    await settle();
    expect(screen.queryByTestId('notification-consent')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('EVM-108 AC2: with notifications off and a file waiting from before, "Gotowe" without a new photo asks too', async () => {
    const { rig } = setup();
    const waiting: MediaUploadsSnapshot = {
      files: [{ assetId: 'a', status: 'waiting', percent: null, sizeBytes: 1, actions: [], code: null, updatedAt: 1 }],
      notifications: 'denied',
    };
    rig.media.set(waiting);
    await mount(rig);
    await fireEvent.press(screen.getByTestId('camera-done'));
    await settle();
    expect(screen.getByTestId('notification-consent')).toBeOnTheScreen();
  });
});

describe('the camera is released unless the screen is the one in front (EVM-108 AC2; security 16)', () => {
  const active = (): unknown => cameraMock.props?.['active'];

  it('EVM-108 AC2: the view is a photo camera of the back lens and is active while the screen is in front, the app in the foreground and unlocked', async () => {
    const { rig } = setup();
    await mount(rig);
    expect(cameraMock.props).toMatchObject({ mode: 'picture', facing: 'back', active: true });
    expect(cameraMock.props).not.toHaveProperty('barcodeScannerSettings');
    expect(cameraMock.props).not.toHaveProperty('onBarcodeScanned');
    expect(cameraMock.props).not.toHaveProperty('mute');
  });

  it('EVM-108 AC2: another layer over the screen (a dialog) releases the camera', async () => {
    const { rig } = setup();
    await mount(rig, { focused: false });
    expect(active()).toBe(false);
  });

  it('EVM-108 AC2: the app in the background releases the camera and its return takes it again', async () => {
    const { rig } = setup();
    const change = foregroundEvents();
    await mount(rig);
    expect(active()).toBe(true);
    await act(() => {
      change('background');
    });
    expect(active()).toBe(false);
    await act(() => {
      change('active');
    });
    expect(active()).toBe(true);
  });

  it('EVM-108 AC2: the lock of the app releases the camera (the content is behind the lock)', async () => {
    const { rig } = setup();
    rig.device.facts.auth = 'cancelled';
    await mount(rig, { locked: true });
    expect(active()).toBe(false);
    rig.device.facts.auth = 'success';
    await act(async () => {
      await rig.device.guard.unlock();
    });
    await settle();
    expect(active()).toBe(true);
  });
});

describe('the top bar shows the number of the order and nothing else (EVM-108 AC2; styleguide § 3.24)', () => {
  const rows = (number: string | null) =>
    buildOrderList(
      {
        orders: [{ id: WO, number, status: 'in_progress', createdAt: 1, customerId: 'c1', siteId: 's1' }],
        customers: [{ id: 'c1', displayName: 'Jan Łódzki Synthetic' }],
        sites: [{ id: 's1', street: 'ul. Żółkiewskiego', buildingNumber: '7', city: 'Łódź', parkingSpot: '15' }],
        stages: [],
      },
      [],
    );

  it('EVM-108 AC2: the number only - no customer, no address, no title; an order without a number says "Oczekuje na numer"', async () => {
    const { rig } = setup();
    rig.sync.rows = rows('ZL-2026-0042');
    await mount(rig);
    expect(screen.getByRole('header', { name: 'ZL-2026-0042' })).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/Łódzki|Żółkiewskiego|Łódź/);
    const second = setup();
    second.rig.sync.rows = rows(null);
    await screen.unmount();
    await mount(second.rig);
    expect(screen.getByRole('header', { name: 'Oczekuje na numer' })).toBeOnTheScreen();
  });

  it('EVM-108 AC2: in the hidden-data mode the number is not read at all and the bar says "Aparat"; the camera works', async () => {
    const { rig } = setup();
    rig.sync.rows = rows('ZL-2026-0042');
    rig.device.facts.secure = false;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    const asked = jest.spyOn(rig.sync, 'orderList');
    await mount(rig);
    expect(asked).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Aparat' })).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toContain('ZL-2026-0042');
    await choose('other');
    await shoot();
    expect(count()).toBe('1 zdjęcie');
  });

  it('EVM-108 AC2: no banner of the connection covers the preview, the capsule of the synchronization stays', async () => {
    const { rig } = setup();
    await mount(rig);
    expect(screen.getByTestId('sync-indicator')).toBeOnTheScreen();
    expect(screen.queryByText(/Brak zasięgu/)).toBeNull();
  });

  it('EVM-108 AC2: no test id of the camera holds a number, a title or a name', async () => {
    const { rig } = setup();
    rig.sync.rows = rows('ZL-2026-0042');
    await mount(rig);
    const ids: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return;
      const json = node as { props?: { testID?: string }; children?: unknown[] };
      if (typeof json.props?.testID === 'string') ids.push(json.props.testID);
      json.children?.forEach(walk);
    };
    walk(screen.toJSON());
    expect(ids.length).toBeGreaterThan(8);
    expect(ids.join(' ')).not.toMatch(/ZL-|Łódź|Jan|Żółkiewskiego/);
  });
});

describe('the permission of the camera (EVM-108 AC3)', () => {
  it('EVM-108 AC3: before the first request the explaining screen is shown with the texts of the story; "Zezwól na dostęp do aparatu" opens the system prompt and a granted answer starts the camera', async () => {
    const { rig } = setup();
    cameraMock.set(UNDETERMINED);
    await mount(rig);
    expect(screen.getByText('Aparat do zdjęć z prac')).toBeOnTheScreen();
    expect(screen.getByText(/bez zapisu w galerii, bez lokalizacji/)).toBeOnTheScreen();
    expect(screen.queryByTestId('camera-view')).toBeNull();
    expect(cameraMock.prompts).toBe(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Zezwól na dostęp do aparatu' }));
    await settle();
    expect(cameraMock.prompts).toBe(1);
    expect(screen.getByTestId('camera-view')).toBeOnTheScreen();
  });

  it('EVM-108 AC3: after a refusal the same explaining screen returns; "Nie teraz" goes back to the order and touches nothing in the queue', async () => {
    const { rig } = setup();
    cameraMock.set(UNDETERMINED);
    cameraMock.promptResult = DENIED;
    const onClose = await mount(rig);
    await fireEvent.press(screen.getByTestId('camera-allow'));
    await settle();
    expect(screen.getByText('Aparat do zdjęć z prac')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Zezwól na dostęp do aparatu' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Nie teraz' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(rig.sync.enqueued).toEqual([]);
    expect(rig.media.calls).toEqual([]);
  });

  it('EVM-108 AC3: a permanent refusal says so and offers "Otwórz ustawienia" (the settings of the phone), no second prompt', async () => {
    const { rig } = setup();
    cameraMock.set(BLOCKED);
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await mount(rig);
    expect(screen.getByText('Brak dostępu do aparatu. Zezwól aplikacji na używanie aparatu w ustawieniach telefonu.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Zezwól na dostęp do aparatu' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Otwórz ustawienia' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(cameraMock.prompts).toBe(0);
  });

  it('EVM-108 AC3: a refusal of the settings page does not break the screen', async () => {
    const { rig } = setup();
    cameraMock.set(BLOCKED);
    jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('synthetic'));
    await mount(rig);
    await fireEvent.press(screen.getByTestId('camera-open-settings'));
    await settle();
    expect(screen.getByTestId('camera-permission')).toBeOnTheScreen();
  });

  it('EVM-108 AC3: back from the settings with a granted permission the camera starts by itself (the permission is read again in the foreground)', async () => {
    const { rig } = setup();
    cameraMock.set(BLOCKED);
    const change = foregroundEvents();
    await mount(rig);
    expect(screen.queryByTestId('camera-view')).toBeNull();
    // the user grants it in the settings: the system answers differently now, the app learns it on the return to the foreground
    cameraMock.permission = GRANTED;
    await act(() => {
      change('background');
    });
    expect(cameraMock.reads).toBe(0);
    await act(() => {
      change('active');
    });
    await settle();
    expect(cameraMock.reads).toBe(1);
    expect(screen.getByTestId('camera-view')).toBeOnTheScreen();
  });

  it('EVM-108 AC3: the system "back" on the explaining screen is "Nie teraz"', async () => {
    const { rig } = setup();
    cameraMock.set(UNDETERMINED);
    const handlers: (() => unknown)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_name, handler) => {
      handlers.push(handler as () => unknown);
      return { remove: () => undefined };
    });
    const onClose = await mount(rig);
    expect(handlers.at(-1)?.()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('EVM-108 AC3: while the first reading of the permission is on its way only the start text is shown', async () => {
    const { rig } = setup();
    cameraMock.set(null);
    await mount(rig);
    expect(screen.getByText('Uruchamianie aparatu…')).toBeOnTheScreen();
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('EVM-108 AC3: through the whole path - ask, refuse, block, grant - the app never asks for the microphone, the location, the storage or any other permission of the library', async () => {
    const { rig } = setup();
    cameraMock.set(UNDETERMINED);
    cameraMock.promptResult = BLOCKED;
    await mount(rig);
    await fireEvent.press(screen.getByTestId('camera-allow'));
    await settle();
    cameraMock.set(GRANTED);
    await settle();
    await choose('other');
    await shoot();
    expect(cameraMock.forbidden).not.toHaveBeenCalled();
    expect(count()).toBe('1 zdjęcie');
  });
});

describe('no space and the errors of the camera (EVM-108 AC4)', () => {
  it('EVM-108 AC4: little space warns with the real value ("Mało miejsca w telefonie: 1,2 GB.") and the photo still works', async () => {
    const { rig } = setup({ free: Math.floor(1.25 * GB) });
    await mount(rig);
    expect(screen.getByText('Mało miejsca w telefonie: 1,2 GB.')).toBeOnTheScreen();
    await choose('other');
    await shoot();
    expect(count()).toBe('1 zdjęcie');
  });

  it('EVM-108 AC4: plenty of space shows no warning; the warning follows the free space after every shot', async () => {
    const { rig, state } = setup();
    await mount(rig);
    expect(screen.queryByTestId('camera-low-space')).toBeNull();
    await choose('other');
    state.free = 700 * 1024 * 1024;
    await shoot();
    expect(screen.getByText('Mało miejsca w telefonie: 700 MB.')).toBeOnTheScreen();
  });

  it('EVM-108 AC4: no space ("Brak miejsca — …") - nothing is taken, the counter and the queue stay as they were', async () => {
    const { rig, originals, photos } = setup({ free: BLOCK_BELOW_BYTES - 1 });
    await mount(rig);
    await choose('other');
    await shoot();
    expect(screen.getByText('Brak miejsca — zdjęcie nie zostało zapisane. Zwolnij miejsce w telefonie.')).toBeOnTheScreen();
    expect(screen.getByTestId('camera-problem')).toHaveProp('accessibilityRole', 'alert');
    expect(cameraMock.takePictureAsync).not.toHaveBeenCalled();
    expect(count()).toBe('0 zdjęć');
    expect(originals.size).toBe(0);
    expect(photos).toEqual([]);
  });

  it('EVM-108 AC4: the native import refuses for lack of space - the same words, no file, no entry', async () => {
    const { rig, originals, photos } = setup({ importResult: 'no_space' });
    await mount(rig);
    await choose('other');
    await shoot();
    expect(screen.getByText(pl.camera.noSpace)).toBeOnTheScreen();
    expect(count()).toBe('0 zdjęć');
    expect(originals.size + photos.length).toBe(0);
  });

  it('EVM-108 AC4: a failed save ("Nie udało się zapisać zdjęcia. Zrób je ponownie.") leaves no file and no entry; the next shot works and clears the message', async () => {
    const { rig, state, originals, photos } = setup({ registerOk: false });
    await mount(rig);
    await choose('other');
    await shoot();
    expect(screen.getByText('Nie udało się zapisać zdjęcia. Zrób je ponownie.')).toBeOnTheScreen();
    expect(count()).toBe('0 zdjęć');
    expect(originals.size + photos.length).toBe(0);
    state.registerOk = true;
    await shoot();
    expect(screen.queryByTestId('camera-problem')).toBeNull();
    expect(count()).toBe('1 zdjęcie');
    expect(originals.size).toBe(1);
  });

  it('EVM-108 AC4: a camera that gives no picture is a failed save in words, with nothing changed', async () => {
    const { rig, originals } = setup();
    cameraMock.takePictureAsync.mockRejectedValue(new Error('synthetic'));
    await mount(rig);
    await choose('other');
    await shoot();
    expect(screen.getByText(pl.camera.saveFailed)).toBeOnTheScreen();
    expect(count()).toBe('0 zdjęć');
    expect(originals.size).toBe(0);
  });

  it('EVM-108 AC4: an error of the start of the camera says "Nie udało się uruchomić aparatu." with "Spróbuj ponownie"; the retry starts the camera again', async () => {
    const { rig } = setup();
    cameraMock.mountError = true;
    await mount(rig);
    expect(screen.getByText('Nie udało się uruchomić aparatu.')).toBeOnTheScreen();
    expect(screen.queryByTestId('camera-shutter')).toBeNull();
    cameraMock.mountError = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await settle();
    expect(screen.queryByText('Nie udało się uruchomić aparatu.')).toBeNull();
    expect(screen.getByTestId('camera-shutter')).toBeOnTheScreen();
    expect(cameraMock.mounts).toBe(2);
  });

  it('EVM-108 AC4: while the camera starts the text is "Uruchamianie aparatu…" with NO spinner, and the shutter waits', async () => {
    const { rig } = setup();
    cameraMock.readyOnMount = false;
    await mount(rig);
    expect(screen.getByText('Uruchamianie aparatu…')).toBeOnTheScreen();
    expect(screen.queryByRole('progressbar')).toBeNull();
    await choose('other');
    expect(shutter()).toBeDisabled();
  });

  it('EVM-108 AC4: a failed camera can be closed ("Zamknij") and the system "back" returns to the order', async () => {
    const { rig } = setup();
    cameraMock.mountError = true;
    const onClose = await mount(rig);
    await fireEvent.press(screen.getByTestId('camera-close'));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the camera in the shell: the port openCamera (EVM-108 AC2, security 18)', () => {
  const rigWith = (): PortsRig => {
    const s = setup();
    s.rig.sync.rows = buildOrderList(
      {
        orders: [{ id: WO, number: 'ZL-2026-0042', status: 'in_progress', createdAt: 1, customerId: null, siteId: null }],
        customers: [],
        sites: [],
        stages: [],
      },
      [],
    );
    s.rig.sync.details.set(WO, {
      id: WO,
      number: 'ZL-2026-0042',
      title: 'Garaż',
      status: 'in_progress',
      customer: null,
      location: null,
      scope: [],
      processes: [],
      journal: [],
    });
    return s.rig;
  };
  const open = async (rig: PortsRig) => {
    await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
    await settle();
  };

  it('EVM-108 AC2: the camera opens for an order of the replica and "Gotowe" closes it back to the shell', async () => {
    const rig = rigWith();
    await open(rig);
    await act(async () => {
      await expect(rig.ports.camera.open(WO)).resolves.toBe(true);
    });
    await settle();
    expect(screen.getByTestId('camera')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('camera-done'));
    await settle();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(rig.ports.camera.getSnapshot()).toBeNull();
  });

  it('EVM-108 AC2 (security 18): an order that is not on the phone is refused - no camera, no state', async () => {
    const rig = rigWith();
    await open(rig);
    await act(async () => {
      await expect(rig.ports.camera.open('10000000-0000-4000-8000-0000000000ff')).resolves.toBe(false);
    });
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(rig.ports.camera.getSnapshot()).toBeNull();
  });
});
