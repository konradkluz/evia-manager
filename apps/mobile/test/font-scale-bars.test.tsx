// EVM-151: the app bar and the bottom navigation at a large system font (130-200%). A layout engine is not in Jest, so the proof is the
// tier hook, the structure and the SOURCE of the shared parts (no line limit, no switched-off scaling, no fixed height of text); the
// screenshots of the emulator are in docs/qa/EVM-151 (Maestro 150-font-scale-bars).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Dimensions, PixelRatio, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppBar, BackButton, BottomNav, ClipboardList, ListChecks, SyncIndicator } from '../src/ui';
import { FONT_SCALE_LARGE, FONT_SCALE_MEDIUM, fontScaleTier, useFontScaleTier } from '../src/ui/fontScale';
import { size } from '../src/ui/theme';

const metrics = { frame: { x: 0, y: 0, width: 360, height: 760 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const inProvider = (element: ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>;
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

/** The system font scale and the window width of the "device". */
function device(fontScale: number, width: number): () => void {
  const font = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(fontScale);
  const dims = jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 900, scale: 2.6, fontScale });
  return () => {
    font.mockRestore();
    dims.mockRestore();
  };
}

const SRC = join(__dirname, '..', 'src');
const code = (...parts: string[]): string =>
  readFileSync(join(SRC, ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const items = [
  {
    key: 'a',
    label: 'Moje zlecenia',
    shortLabel: 'Zlecenia',
    icon: ClipboardList,
    selected: true,
    onPress: () => undefined,
    testID: 'nav-a',
  },
  { key: 'b', label: 'Kolejka', icon: ListChecks, selected: false, onPress: () => undefined, testID: 'nav-b' },
];

describe('font scale tiers (EVM-151 AC1-AC4)', () => {
  it('EVM-151 AC4: up to 100% the tier is normal at 411 and at 360 dp - the bar looks as before', () => {
    expect(fontScaleTier(1, 411)).toBe('normal');
    expect(fontScaleTier(1, 360)).toBe('normal');
    expect(fontScaleTier(0.85, 360)).toBe('normal');
  });

  it('EVM-151 AC2: between 100% and 130% the tier is medium on a wide screen and large on a narrow one', () => {
    expect(FONT_SCALE_MEDIUM).toBe(1);
    expect(FONT_SCALE_LARGE).toBe(1.3);
    expect(fontScaleTier(1.15, 411)).toBe('medium');
    expect(fontScaleTier(1.3, 411)).toBe('medium');
    expect(fontScaleTier(1.15, 360)).toBe('large');
  });

  it('EVM-151 AC1: above 130% the tier is large at 411 and at 360 dp', () => {
    expect(fontScaleTier(1.31, 411)).toBe('large');
    expect(fontScaleTier(2, 411)).toBe('large');
    expect(fontScaleTier(2, 360)).toBe('large');
  });

  it('EVM-151 AC1: the hook reads the font scale and the width of the window', async () => {
    const restore = device(2, 360);
    try {
      expect((await renderHook(() => useFontScaleTier())).result.current).toBe('large');
    } finally {
      restore();
    }
  });
});

describe('AppBar at a large font (EVM-151 AC1, AC2, AC4)', () => {
  const bar = () =>
    inProvider(
      <AppBar
        title="Zdjęcia zlecenia"
        left={<BackButton accessibilityLabel="Wróć do zlecenia" onPress={() => undefined} testID="back" />}
        right={
          <SyncIndicator
            state="online"
            label="Zsynchr. 11:15"
            accessibilityLabel="Zsynchronizowano o 11:15"
            onPress={() => undefined}
            testID="cap"
          />
        }
      />,
    );

  it('EVM-151 AC4: at 100% one row - the back action on the left, the title in the middle, the capsule on the right', async () => {
    const restore = device(1, 411);
    try {
      await render(bar());
      expect(flat(screen.getByTestId('app-bar')).flexDirection).toBe('row');
      expect(screen.queryByTestId('app-bar-actions')).toBeNull();
    } finally {
      restore();
    }
  });

  it('EVM-151 AC2: at 200% two rows - the back action and the capsule on the first, the title on the whole width of the second', async () => {
    const restore = device(2, 411);
    try {
      await render(bar());
      expect(flat(screen.getByTestId('app-bar')).flexDirection).toBe('column');
      expect(flat(screen.getByTestId('app-bar-actions')).flexDirection).toBe('row');
      expect(screen.getByTestId('back')).toBeOnTheScreen();
      expect(screen.getByTestId('cap')).toBeOnTheScreen();
      expect(flat(screen.getByRole('header')).alignSelf).toBe('stretch');
    } finally {
      restore();
    }
  });

  it('EVM-151 AC1: the title is never limited or fitted - it wraps on spaces at 130%, 200% and 360 dp', async () => {
    for (const [scale, width] of [
      [1.3, 411],
      [2, 411],
      [2, 360],
    ] as const) {
      const restore = device(scale, width);
      try {
        await render(bar());
        const title = screen.getByRole('header', { name: 'Zdjęcia zlecenia' });
        expect(title.props.numberOfLines).toBeUndefined();
        expect(title.props.adjustsFontSizeToFit).toBeUndefined();
        expect(title.props.maxFontSizeMultiplier).toBeUndefined();
        expect(title.props.ellipsizeMode).toBeUndefined();
      } finally {
        restore();
      }
    }
  });

  it('EVM-151 AC2: at 130% on a wide screen one row, the title keeps at least 96 dp', async () => {
    const restore = device(1.3, 411);
    try {
      await render(bar());
      expect(flat(screen.getByTestId('app-bar')).flexDirection).toBe('row');
      expect(flat(screen.getByRole('header')).minWidth).toBe(96);
    } finally {
      restore();
    }
  });

  it('EVM-151 AC2: the bar has a minimum height and grows with the content (no fixed height)', async () => {
    const restore = device(2, 360);
    try {
      await render(bar());
      const style = flat(screen.getByTestId('app-bar'));
      expect(style.minHeight).toBe(size.appBar.height.mobile + 24);
      expect(style.height).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('EVM-151 AC2: the capsule keeps its full text at every tier (no line limit) and 48 dp of height', async () => {
    const restore = device(2, 360);
    try {
      await render(bar());
      expect(screen.getByText('Zsynchr. 11:15').props.numberOfLines).toBeUndefined();
      expect(flat(screen.getByTestId('cap')).minHeight).toBeGreaterThanOrEqual(size.touchTarget.min);
      expect(screen.getByRole('button', { name: 'Zsynchronizowano o 11:15' })).toBeOnTheScreen();
    } finally {
      restore();
    }
  });

  it('EVM-151 AC2: without a back action and a capsule (a bar of the title only) the title stands alone', async () => {
    const restore = device(2, 360);
    try {
      await render(inProvider(<AppBar title="Moje zlecenia" />));
      expect(screen.getByRole('header', { name: 'Moje zlecenia' })).toBeOnTheScreen();
      expect(screen.queryByTestId('app-bar-actions')).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('BackButton (EVM-151 AC2; styleguide § 3.18)', () => {
  it('EVM-151 AC2: an icon in a 48 x 48 dp target with the name for the screen reader; it presses', async () => {
    const onPress = jest.fn();
    await render(<BackButton accessibilityLabel="Wróć do zlecenia" onPress={onPress} testID="back" />);
    const back = screen.getByRole('button', { name: 'Wróć do zlecenia' });
    const style = flat(back);
    expect(style.minWidth).toBe(size.touchTarget.min);
    expect(style.minHeight).toBe(size.touchTarget.min);
    await fireEvent.press(back);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('EVM-151 AC2: the focus ring is the inverse one', async () => {
    await render(<BackButton accessibilityLabel="Wstecz" onPress={() => undefined} testID="back" />);
    const back = screen.getByTestId('back');
    expect(flat(back).borderColor).toBe('transparent');
    await fireEvent(back, 'focus');
    expect(flat(back).borderColor).not.toBe('transparent');
  });
});

describe('BottomNav at a large font (EVM-151 AC3, AC4)', () => {
  it('EVM-151 AC3: at 200% and 360 dp the short label stands in the sight, the name for the reader stays full', async () => {
    const restore = device(2, 360);
    try {
      await render(inProvider(<BottomNav accessibilityLabel="Nawigacja" items={items} />));
      expect(screen.getByText('Zlecenia')).toBeOnTheScreen();
      expect(screen.queryByText('Moje zlecenia')).toBeNull();
      expect(screen.getByRole('tab', { name: 'Moje zlecenia', selected: true })).toBeOnTheScreen();
    } finally {
      restore();
    }
  });

  it('EVM-151 AC3: at 200% on a wide screen (above 400 dp) the full label wraps - the short one is not used', async () => {
    const restore = device(2, 411);
    try {
      await render(inProvider(<BottomNav accessibilityLabel="Nawigacja" items={items} />));
      expect(screen.getByText('Moje zlecenia')).toBeOnTheScreen();
    } finally {
      restore();
    }
  });

  it('EVM-151 AC4: at 100% the full label at 360 dp', async () => {
    const restore = device(1, 360);
    try {
      await render(inProvider(<BottomNav accessibilityLabel="Nawigacja" items={items} />));
      expect(screen.getByText('Moje zlecenia')).toBeOnTheScreen();
    } finally {
      restore();
    }
  });

  it('EVM-151 AC3: a label has no line limit, every item is a target of at least 48 dp and the state is more than the colour', async () => {
    const restore = device(2, 360);
    try {
      await render(inProvider(<BottomNav accessibilityLabel="Nawigacja" items={items} />));
      expect(screen.getByText('Zlecenia').props.numberOfLines).toBeUndefined();
      expect(screen.getByText('Kolejka').props.numberOfLines).toBeUndefined();
      const selected = flat(screen.getByTestId('nav-a'));
      expect(selected.minHeight).toBeGreaterThanOrEqual(size.touchTarget.min);
      expect(selected.height).toBeUndefined();
      expect(flat(screen.getByText('Zlecenia')).fontWeight).toBe('600');
      expect(flat(screen.getByText('Kolejka')).fontWeight).toBe('500');
    } finally {
      restore();
    }
  });
});

describe('source of the shared bars (EVM-151 AC5; the pattern of EVM-110 AC6)', () => {
  const PARTS: readonly (readonly [string, string[]])[] = [
    ['AppBar', ['ui', 'AppBar.tsx']],
    ['BackButton', ['ui', 'BackButton.tsx']],
    ['BottomNav', ['ui', 'BottomNav.tsx']],
    ['SyncIndicator', ['ui', 'SyncIndicator.tsx']],
  ];

  it.each(PARTS)(
    'EVM-151 AC5: %s - no limit of lines, no switched-off scaling, no capped multiplier, no fitting to the width',
    (_name, path) => {
      const source = code(...path);
      expect(source).not.toMatch(/numberOfLines/);
      expect(source).not.toMatch(/allowFontScaling\s*=\s*\{?\s*false/);
      expect(source).not.toMatch(/maxFontSizeMultiplier/);
      expect(source).not.toMatch(/adjustsFontSizeToFit/);
      expect(source).not.toMatch(/ellipsizeMode/);
    },
  );

  it.each(PARTS)('EVM-151 AC5: %s - no fixed height of a container with text (only min-heights)', (_name, path) => {
    const lines = code(...path)
      .split('\n')
      .filter((line) => !/size\.icon|iconSize|indicator\.height|touchTarget/.test(line));
    expect(lines.filter((line) => /(^|[^A-Za-z])(height|maxHeight)\s*:/.test(line))).toEqual([]);
  });
});
