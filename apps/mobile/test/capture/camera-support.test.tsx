// The parts around the camera screen (EVM-108 AC1-AC4): the library components, the permission states, the port openCamera, the text of the free space
// and the pipeline of the queue of files. The screen itself is in camera-screen.test.tsx.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CameraRequests } from '../../src/capture/camera-requests';
import { permissionState } from '../../src/capture/camera-permission';
import { formatFreeSpace } from '../../src/i18n/format';
import { Button, CameraPanel, CameraShutter, FilterChip } from '../../src/ui';
import { color, size } from '../../src/ui/theme';
import { MediaUploads } from '../../src/upload/media-uploads';

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

const styleOf = (node: { props: { style?: unknown } }): Record<string, unknown> =>
  StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) as Record<string, unknown>;

describe('the shutter and the panel of the camera (EVM-108 AC2; styleguide § 3.24)', () => {
  it('EVM-108 AC2: the shutter is 72 dp (the token), round, with the outline "border.inverse", a name and a hint', async () => {
    const onPress = jest.fn();
    await render(
      <CameraShutter
        accessibilityLabel="Zrób zdjęcie"
        accessibilityHint="Wybierz kategorię przed zdjęciem."
        onPress={onPress}
        testID="s"
      />,
    );
    const shutter = screen.getByRole('button', { name: 'Zrób zdjęcie' });
    expect(shutter).toHaveProp('accessibilityHint', 'Wybierz kategorię przed zdjęciem.');
    const style = styleOf(shutter);
    expect(style).toMatchObject({
      width: size.touchTarget.shutter,
      height: size.touchTarget.shutter,
      borderColor: color.border.inverse,
      borderStyle: 'solid',
    });
    expect(size.touchTarget.shutter).toBeGreaterThanOrEqual(48);
    await fireEvent.press(shutter);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('EVM-108 AC2: a disabled shutter has a dashed outline (not the colour alone), does not react and says it is disabled; the focus uses the inverse ring', async () => {
    const onPress = jest.fn();
    await render(<CameraShutter accessibilityLabel="Zrób zdjęcie" onPress={onPress} disabled testID="s" />);
    const shutter = screen.getByTestId('s');
    expect(styleOf(shutter)).toMatchObject({ borderStyle: 'dashed' });
    expect(shutter).toBeDisabled();
    await fireEvent.press(shutter);
    expect(onPress).not.toHaveBeenCalled();
    await render(<CameraShutter accessibilityLabel="Zrób zdjęcie" onPress={onPress} testID="f" />);
    const focusable = screen.getByTestId('f');
    await fireEvent(focusable, 'focus');
    expect(styleOf(screen.getByTestId('f'))).toMatchObject({ borderColor: color.focus.ringInverse });
    await fireEvent(screen.getByTestId('f'), 'blur');
    expect(styleOf(screen.getByTestId('f'))).toMatchObject({ borderColor: color.border.inverse });
  });

  it('EVM-108 AC2: the dark chip: outline "border.inverse" and light text when not chosen; the chosen one is a light surface with the dark text and a check; a radio with a state', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <FilterChip label="Inne" accessibilityLabel="Inne" selected={false} radio onDark onPress={onPress} testID="off" />
        <FilterChip label="Pomiary" accessibilityLabel="Pomiary" selected radio onDark onPress={onPress} testID="on" />
      </>,
    );
    expect(styleOf(screen.getByTestId('off'))).toMatchObject({ borderColor: color.border.inverse, backgroundColor: 'transparent' });
    expect(styleOf(screen.getByTestId('on'))).toMatchObject({ backgroundColor: color.bg.surface });
    expect(screen.getByRole('radio', { name: 'Pomiary' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Inne' })).not.toBeChecked();
    expect(screen.getByText('Inne')).toHaveStyle({ color: color.text.onBrand });
    expect(screen.getByText('Pomiary')).toHaveStyle({ color: color.text.primary });
    expect(styleOf(screen.getByTestId('off')).minHeight).toBe(size.touchTarget.min);
    await fireEvent(screen.getByTestId('off'), 'focus');
    expect(styleOf(screen.getByTestId('off'))).toMatchObject({ borderColor: color.focus.ringInverse });
    await fireEvent.press(screen.getByTestId('off'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('EVM-108 AC2: the light chip keeps its look (the dark variant is opt-in)', async () => {
    await render(<FilterChip label="Inne" accessibilityLabel="Inne" selected onPress={() => undefined} testID="chip" />);
    expect(styleOf(screen.getByTestId('chip'))).toMatchObject({ borderColor: color.border.selected, backgroundColor: color.bg.selected });
  });

  it('EVM-108 AC2: "Gotowe" on the dark panel is a primary button with the outline "border.inverse"; a plain primary button keeps its transparent border', async () => {
    await render(
      <>
        <Button label="Gotowe" onPress={() => undefined} inverse buttonSize="lg" testID="done" />
        <Button label="Zapisz" onPress={() => undefined} testID="plain" />
      </>,
    );
    expect(styleOf(screen.getByTestId('done'))).toMatchObject({ borderColor: color.border.inverse, borderWidth: 2 });
    expect(styleOf(screen.getByTestId('done')).minHeight).toBe(size.touchTarget.field);
    expect(styleOf(screen.getByTestId('plain'))).toMatchObject({ borderColor: 'transparent' });
  });

  it('EVM-108 AC2: the panel is the dark surface with the chips as a radio group and the three cells of the control row', async () => {
    await render(
      <SafeAreaProvider>
        <CameraPanel
          chipsLabel="Kategoria"
          chips={<FilterChip label="Inne" accessibilityLabel="Inne" selected={false} radio onDark onPress={() => undefined} />}
          counter={<></>}
          shutter={<CameraShutter accessibilityLabel="Zrób zdjęcie" onPress={() => undefined} />}
          done={<Button label="Gotowe" onPress={() => undefined} inverse />}
          notice={<></>}
        />
      </SafeAreaProvider>,
    );
    expect(screen.getByLabelText('Kategoria')).toHaveProp('accessibilityRole', 'radiogroup');
    expect(screen.getByRole('button', { name: 'Zrób zdjęcie' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Gotowe' })).toBeOnTheScreen();
  });
});

describe('the four states of the camera permission (EVM-108 AC3)', () => {
  it.each([
    [null, null],
    [{ status: 'undetermined', canAskAgain: true }, 'undetermined'],
    [{ status: 'granted', canAskAgain: true }, 'granted'],
    [{ status: 'granted', canAskAgain: false }, 'granted'],
    [{ status: 'denied', canAskAgain: true }, 'denied_can_ask'],
    [{ status: 'denied', canAskAgain: false }, 'denied_blocked'],
    [{ status: 'something-new', canAskAgain: false }, 'undetermined'],
  ])('EVM-108 AC3: the answer %j is the state %s', (answer, state) => {
    expect(permissionState(answer)).toBe(state);
  });
});

describe('the port openCamera (EVM-108; security 18)', () => {
  const source = (ids: string[], fails = false) => ({
    orders: () => (fails ? Promise.reject(new Error('synthetic')) : Promise.resolve(ids.map((id) => ({ id })))),
  });

  it('EVM-108 AC2: it opens only an order that is on the phone, tells the listeners once and closes on request', async () => {
    const requests = new CameraRequests(source(['a', 'b']));
    const seen: (string | null)[] = [];
    const stop = requests.subscribe(() => seen.push(requests.getSnapshot()));
    await expect(requests.open('b')).resolves.toBe(true);
    await expect(requests.open('b')).resolves.toBe(true);
    expect(requests.getSnapshot()).toBe('b');
    expect(seen).toEqual(['b']);
    requests.close();
    requests.close();
    expect(requests.getSnapshot()).toBeNull();
    expect(seen).toEqual(['b', null]);
    stop();
    await requests.open('a');
    expect(seen).toEqual(['b', null]);
  });

  it('EVM-108 AC2: an unknown order is refused, an unreadable replica is a refusal too, and nothing is opened', async () => {
    const unknown = new CameraRequests(source(['a']));
    await expect(unknown.open('x')).resolves.toBe(false);
    expect(unknown.getSnapshot()).toBeNull();
    const broken = new CameraRequests(source(['a'], true));
    await expect(broken.open('a')).resolves.toBe(false);
    expect(broken.getSnapshot()).toBeNull();
  });

  it('EVM-108: the first order of the replica for the e2e hook; none = null, an unreadable replica = null', async () => {
    await expect(new CameraRequests(source(['a', 'b'])).firstOrderId()).resolves.toBe('a');
    await expect(new CameraRequests(source([])).firstOrderId()).resolves.toBeNull();
    await expect(new CameraRequests(source(['a'], true)).firstOrderId()).resolves.toBeNull();
  });
});

describe('the free space in words (EVM-108 AC4)', () => {
  it.each([
    [Math.floor(1.25 * 1024 ** 3), '1,2 GB'],
    [Math.floor(1.99 * 1024 ** 3), '1,9 GB'],
    [1024 ** 3, '1,0 GB'],
    [640 * 1024 ** 2, '640 MB'],
    [100 * 1024 ** 2, '100 MB'],
    [-5, '0 MB'],
  ])('EVM-108 AC4: %i bytes read "%s" (the real value, rounded down)', (bytes, text) => {
    expect(formatFreeSpace(bytes)).toBe(text);
  });
});

describe('the pipeline of the queue of files (EVM-108 AC1, AC4)', () => {
  const native = {
    importOriginal: () => Promise.resolve('ok' as const),
    digestOriginal: () => Promise.resolve({ sizeBytes: 10, sha256: 'a'.repeat(64) }),
    cancelUpload: () => Promise.resolve(true),
  };
  const deps = (capture?: { disk: { freeBytes: () => number | null }; newId: () => string }) =>
    ({
      native,
      store: () => null,
      enqueue: () => Promise.resolve({ ok: false }),
      now: () => 1,
      dataVisible: () => true,
      ...(capture === undefined ? {} : { capture }),
    }) as unknown as ConstructorParameters<typeof MediaUploads>[0];

  it('EVM-108 AC1: with the session ports the pipeline takes the picture of the screen and the free space is read from the phone', async () => {
    const uploads = new MediaUploads(
      deps({ disk: { freeBytes: () => 5 * 1024 ** 3 }, newId: () => '0194c2a0-0000-7000-8000-000000000001' }),
    );
    const taken: string[] = [];
    const pipeline = uploads.capturePipeline(() => {
      taken.push('shot');
      return Promise.resolve({ uri: 'file:///cache/Camera/x.jpg' });
    });
    // no session store: the registration is refused, the original is removed again - and the answer is typed, never a throw
    await expect(pipeline.capture({ workOrderId: '10000000-0000-4000-8000-000000000001', category: 'other' })).resolves.toEqual({
      ok: false,
      code: 'save_failed',
    });
    expect(taken).toEqual(['shot']);
    expect(uploads.freeDiskBytes()).toBe(5 * 1024 ** 3);
  });

  it('EVM-108 AC4: without the ports of the camera no picture is taken ("camera_failed") and the free space is unknown', async () => {
    const uploads = new MediaUploads(deps());
    const pipeline = uploads.capturePipeline(() => Promise.resolve({ uri: 'file:///cache/Camera/x.jpg' }));
    await expect(pipeline.capture({ workOrderId: '10000000-0000-4000-8000-000000000001', category: 'other' })).resolves.toEqual({
      ok: false,
      code: 'camera_failed',
    });
    expect(uploads.freeDiskBytes()).toBeNull();
  });
});
