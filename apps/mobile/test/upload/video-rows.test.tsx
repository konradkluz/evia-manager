// A film in the lists and the small parts of the film mode (EVM-110 AC1, AC3, AC6): the row of the queue, the notice of a killed recording, the chips,
// the shutter, the screen kept on by the native module.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { formatDateTime } from '../../src/i18n/format';
import { FileRow } from '../../src/screens/FileRow';
import { InterruptedRecordingNotice } from '../../src/screens/InterruptedRecordingNotice';
import { SessionContext, type SessionActions } from '../../src/screens/session-context';
import { CameraShutter, FilterChip } from '../../src/ui';
import { MediaUploads } from '../../src/upload/media-uploads';
import type { NativeUpload } from '../../src/upload/native-upload';
import type { MediaFileView } from '../../src/upload/types';
import { stubPorts } from '../session-helpers';

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context');
  return { ...actual, useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) };
});

const MB = 1024 * 1024;
const AT = Date.UTC(2026, 10, 15, 8, 12);
const settle = () =>
  act(async () => {
    for (let n = 0; n < 8; n += 1) await Promise.resolve();
  });

const video = (patch: Partial<MediaFileView> = {}): MediaFileView => ({
  assetId: '0194c2a0-0000-7000-8000-000000000001',
  status: 'waiting',
  percent: null,
  sizeBytes: 78 * MB,
  actions: [],
  code: null,
  updatedAt: AT,
  category: 'defect',
  mediaType: 'video',
  capturedAt: AT,
  durationMs: 133_400,
  ...patch,
});

describe('the row of a film (EVM-110 AC1)', () => {
  it('EVM-110 AC1: the row shows the icon of the film, the length and the size - and no order, customer or address', async () => {
    await render(<FileRow file={video()} testID="row" />);
    expect(screen.getByTestId('row-type')).toHaveTextContent(`${formatDateTime(AT)} · Film · 2:13 · 78 MB`);
    expect(screen.getByText('Usterka / problem')).toBeOnTheScreen();
    // the spoken name carries the same facts in one sentence
    expect(screen.getByLabelText(`Usterka / problem, Film · 2:13 · 78 MB, ${formatDateTime(AT)}, Oczekuje`)).toBeOnTheScreen();
    const text = JSON.stringify(screen.toJSON());
    expect(text).not.toMatch(/ZL-|ul\.|Kowalsk|uri|file:\/\//i);
  });

  it('EVM-110 AC1: a film without a stored length shows only the type and the size; a picture shows neither length nor size', async () => {
    await render(
      <View>
        <FileRow file={video({ durationMs: null })} testID="a" />
        <FileRow file={video({ durationMs: undefined, assetId: '0194c2a0-0000-7000-8000-000000000002' })} testID="b" />
        <FileRow file={video({ mediaType: 'photo', durationMs: null, assetId: '0194c2a0-0000-7000-8000-000000000003' })} testID="c" />
      </View>,
    );
    expect(screen.getByTestId('a-type')).toHaveTextContent(`${formatDateTime(AT)} · Film · 78 MB`);
    expect(screen.getByTestId('b-type')).toHaveTextContent(`${formatDateTime(AT)} · Film · 78 MB`);
    expect(screen.getByTestId('c-type')).toHaveTextContent(`${formatDateTime(AT)} · Zdjęcie`);
  });
});

describe('the notice of a recording killed with the process (EVM-110 AC3)', () => {
  const actionsFor = (interrupted: boolean) => {
    const rig = stubPorts();
    rig.media.interrupted = interrupted;
    return { rig, actions: { media: rig.media } as unknown as SessionActions };
  };
  const mount = async (actions: SessionActions) => {
    await render(
      <SessionContext.Provider value={actions}>
        <InterruptedRecordingNotice />
      </SessionContext.Provider>,
    );
    await settle();
  };

  it('EVM-110 AC3: shown once with "Zamknij"; the marker is consumed, so the next start shows nothing', async () => {
    const { rig, actions } = actionsFor(true);
    await mount(actions);
    expect(screen.getByText('Poprzednie nagranie zostało przerwane i nie zostało zapisane.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Zamknij' }));
    expect(screen.queryByTestId('interrupted-recording')).toBeNull();
    expect(rig.media.interrupted).toBe(false);
  });

  it('EVM-110 AC3: nothing is shown when no recording was killed', async () => {
    const { actions } = actionsFor(false);
    await mount(actions);
    expect(screen.queryByTestId('interrupted-recording')).toBeNull();
  });
});

describe('the chips and the shutter in the film mode (EVM-110 AC6)', () => {
  it('EVM-110 AC6: a disabled chip does not react, keeps its dashed outline, and an enabled one has no disabled state at all (the radio state stays as it was)', async () => {
    const onPress = jest.fn();
    await render(
      <View>
        <FilterChip label="Film" accessibilityLabel="Film" selected={false} radio onDark disabled onPress={onPress} testID="off" />
        <FilterChip label="Zdjęcie" accessibilityLabel="Zdjęcie" selected radio onDark onPress={onPress} testID="on" />
      </View>,
    );
    await fireEvent.press(screen.getByTestId('off'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('off')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Zdjęcie' })).toBeChecked();
    await fireEvent.press(screen.getByTestId('on'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("EVM-110 AC6: the shutter shows the square and the danger colour while recording, the circle otherwise; the name and the press are the screen's", async () => {
    const onPress = jest.fn();
    const { rerender } = await render(<CameraShutter accessibilityLabel="Rozpocznij nagrywanie" onPress={onPress} testID="shutter" />);
    const idle = JSON.stringify(screen.toJSON());
    await rerender(<CameraShutter accessibilityLabel="Zatrzymaj nagrywanie" onPress={onPress} recording testID="shutter" />);
    const recording = JSON.stringify(screen.toJSON());
    expect(recording).not.toEqual(idle);
    expect(screen.getByRole('button', { name: 'Zatrzymaj nagrywanie' })).toBeEnabled();
    await fireEvent.press(screen.getByTestId('shutter'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('the screen is kept on by the window flag of the module (EVM-110 AC3)', () => {
  const nativeOf = (setKeepScreenOn: NativeUpload['setKeepScreenOn']): NativeUpload => ({ setKeepScreenOn }) as unknown as NativeUpload;
  const uploads = (native: NativeUpload) =>
    new MediaUploads({
      native,
      store: () => null,
      enqueue: () => Promise.resolve({ ok: false }),
      now: () => 1,
      dataVisible: () => true,
    });

  it('EVM-110 AC3: `keepScreenOn` asks the module for the flag on and off, and never throws when the module fails', () => {
    const calls: boolean[] = [];
    uploads(nativeOf((on) => (calls.push(on), true))).keepScreenOn(true);
    expect(calls).toEqual([true]);
    const failing = uploads(
      nativeOf(() => {
        throw new Error('no activity');
      }),
    );
    expect(() => {
      failing.keepScreenOn(false);
    }).not.toThrow();
  });

  it('EVM-110 AC3: the native module sets and clears FLAG_KEEP_SCREEN_ON on the UI thread - and asks for no wake lock and no permission', () => {
    const code = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'modules',
        'evia-upload',
        'android',
        'src',
        'main',
        'java',
        'pl',
        'eviacharge',
        'upload',
        'android',
        'EviaUploadModule.kt',
      ),
      'utf8',
    ).replaceAll('\r', '');
    const block = /Function\("setKeepScreenOn"\)[\s\S]*?\n {4}\}\n/.exec(code)?.[0] ?? '';
    expect(block).toMatch(/runOnUiThread/);
    expect(block).toMatch(/addFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
    expect(block).toMatch(/clearFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
    expect(code).not.toMatch(/WakeLock|WAKE_LOCK|PowerManager/);
  });
});
