import { describe, expect, it } from 'vitest';
import { cssDeclarations, cssVarName, mobileKey, mobileValue } from '../src/transform.ts';
import { hex, px } from './helpers.ts';

const ms = (value: number): { value: number; unit: string } => ({ value, unit: 'ms' });

const TYPOGRAPHY = {
  fontFamily: ['Exo 2', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
  fontSize: px(14),
  fontWeight: 600,
  letterSpacing: px(-0.2),
  lineHeight: 1.4286,
};

const SHADOW = [
  { color: hex('#000000', 0.12), offsetX: px(0), offsetY: px(1), blur: px(3), spread: px(0) },
  { color: hex('#000000', 0.08), offsetX: px(0), offsetY: px(1), blur: px(2), spread: px(-1) },
];

describe('web transform — CSS variables (EVM-006 AC6)', () => {
  it('EVM-006 AC6: variable names use the --evm- prefix and the token path', () => {
    expect(cssVarName(['color', 'action', 'primary', 'bg-hover'])).toBe('--evm-color-action-primary-bg-hover');
  });

  it('EVM-006 AC6: colors — hex, or rgba() when the color has alpha below 1', () => {
    expect(cssDeclarations({ path: ['color', 'brand'], type: 'color', value: hex('#0D9488') })).toEqual([['--evm-color-brand', '#0D9488']]);
    expect(cssDeclarations({ path: ['color', 'scrim'], type: 'color', value: { ...hex('#336699'), alpha: 0.5 } })).toEqual([
      ['--evm-color-scrim', 'rgba(51, 102, 153, 0.5)'],
    ]);
    expect(cssDeclarations({ path: ['color', 'x'], type: 'color', value: hex('#000000', 1) })).toEqual([['--evm-color-x', '#000000']]);
  });

  it('EVM-006 AC6: spacing in rem (px / 16); borders, radii and other sizes in px', () => {
    expect(cssDeclarations({ path: ['space', 'inset', 'md'], type: 'dimension', value: px(16) })).toEqual([
      ['--evm-space-inset-md', '1rem'],
    ]);
    expect(cssDeclarations({ path: ['space', 'stack', 'xs'], type: 'dimension', value: px(4) })).toEqual([
      ['--evm-space-stack-xs', '0.25rem'],
    ]);
    expect(cssDeclarations({ path: ['radius', 'control'], type: 'dimension', value: px(8) })).toEqual([['--evm-radius-control', '8px']]);
    expect(cssDeclarations({ path: ['border-width', 'default'], type: 'dimension', value: px(1) })).toEqual([
      ['--evm-border-width-default', '1px'],
    ]);
    expect(cssDeclarations({ path: ['size', 'icon', 'sm'], type: 'dimension', value: px(16) })).toEqual([['--evm-size-icon-sm', '16px']]);
  });

  it('EVM-006 AC6: typography expands to one variable per property (rem, unitless line-height, quoted families, tnum)', () => {
    expect(
      cssDeclarations({
        path: ['text', 'numeric'],
        type: 'typography',
        value: TYPOGRAPHY,
        extensions: { 'pl.eviacharge.font': { fontFeatures: ['tnum'] } },
      }),
    ).toEqual([
      ['--evm-text-numeric-font-family', '"Exo 2", Inter, system-ui, -apple-system, sans-serif'],
      ['--evm-text-numeric-font-size', '0.875rem'],
      ['--evm-text-numeric-font-weight', '600'],
      ['--evm-text-numeric-letter-spacing', '-0.0125rem'],
      ['--evm-text-numeric-line-height', '1.4286'],
      ['--evm-text-numeric-font-variant-numeric', 'tabular-nums'],
    ]);
  });

  it('EVM-006 AC6: shadows, transitions, easing curves, durations and numbers', () => {
    expect(cssDeclarations({ path: ['elevation', 'card'], type: 'shadow', value: SHADOW })).toEqual([
      ['--evm-elevation-card', '0 1px 3px 0 rgba(0, 0, 0, 0.12), 0 1px 2px -1px rgba(0, 0, 0, 0.08)'],
    ]);
    expect(cssDeclarations({ path: ['elevation', 'bar'], type: 'shadow', value: SHADOW[0] })).toEqual([
      ['--evm-elevation-bar', '0 1px 3px 0 rgba(0, 0, 0, 0.12)'],
    ]);
    expect(
      cssDeclarations({
        path: ['motion', 'transition', 'hover'],
        type: 'transition',
        value: { duration: ms(100), delay: ms(0), timingFunction: [0.2, 0, 0, 1] },
      }),
    ).toEqual([['--evm-motion-transition-hover', '100ms cubic-bezier(0.2, 0, 0, 1) 0ms']]);
    expect(cssDeclarations({ path: ['motion', 'easing', 'enter'], type: 'cubicBezier', value: [0, 0, 0, 1] })).toEqual([
      ['--evm-motion-easing-enter', 'cubic-bezier(0, 0, 0, 1)'],
    ]);
    expect(cssDeclarations({ path: ['motion', 'duration', 'base'], type: 'duration', value: ms(200) })).toEqual([
      ['--evm-motion-duration-base', '200ms'],
    ]);
    expect(cssDeclarations({ path: ['layer', 'toast'], type: 'number', value: 500 })).toEqual([['--evm-layer-toast', '500']]);
    expect(cssDeclarations({ path: ['font', 'w'], type: 'fontWeight', value: 700 })).toEqual([['--evm-font-w', '700']]);
    expect(cssDeclarations({ path: ['font', 'f'], type: 'fontFamily', value: ['JetBrains Mono', 'monospace'] })).toEqual([
      ['--evm-font-f', '"JetBrains Mono", monospace'],
    ]);
  });

  it('EVM-006 AC6: an unsupported type or unit fails the build instead of producing a wrong value', () => {
    expect(() => cssDeclarations({ path: ['x'], type: 'gradient', value: [] })).toThrow(/unsupported token type gradient/);
    expect(() => cssDeclarations({ path: ['space', 'x'], type: 'dimension', value: { value: 1, unit: 'em' } })).toThrow(/unit/);
    expect(() => cssDeclarations({ path: ['x'], type: 'duration', value: { value: 1, unit: 's' } })).toThrow(/unit/);
  });
});

describe('mobile transform — React Native constants (EVM-006 AC6)', () => {
  it('EVM-006 AC6: keys are camelCase; keys that are not identifiers stay as they are', () => {
    expect(mobileKey('bg-hover')).toBe('bgHover');
    expect(mobileKey('in-progress')).toBe('inProgress');
    expect(mobileKey('2xl')).toBe('2xl');
    expect(mobileKey('md')).toBe('md');
  });

  it('EVM-006 AC6: colors as hex or rgba(), dimensions as dp/pt numbers 1:1, durations in ms, curves as arrays', () => {
    expect(mobileValue({ path: ['color', 'brand'], type: 'color', value: hex('#0D9488') })).toBe('#0D9488');
    expect(mobileValue({ path: ['color', 'scrim'], type: 'color', value: hex('#000000', 0.5) })).toBe('rgba(0, 0, 0, 0.5)');
    expect(mobileValue({ path: ['space', 'md'], type: 'dimension', value: px(16) })).toBe(16);
    expect(mobileValue({ path: ['d'], type: 'duration', value: ms(150) })).toBe(150);
    expect(mobileValue({ path: ['e'], type: 'cubicBezier', value: [0.3, 0, 1, 1] })).toEqual([0.3, 0, 1, 1]);
    expect(mobileValue({ path: ['n'], type: 'number', value: 300 })).toBe(300);
    expect(mobileValue({ path: ['w'], type: 'fontWeight', value: 500 })).toBe('500');
    expect(mobileValue({ path: ['f'], type: 'fontFamily', value: ['Inter', 'system-ui'] })).toBe('Inter');
  });

  it('EVM-006 AC6: typography as a React Native text style (absolute line height, string weight, tabular numbers)', () => {
    expect(
      mobileValue({
        path: ['text', 'numeric'],
        type: 'typography',
        value: TYPOGRAPHY,
        extensions: { 'pl.eviacharge.font': { fontFeatures: ['tnum'] } },
      }),
    ).toEqual({
      fontFamily: 'Exo 2',
      fontSize: 14,
      fontWeight: '600',
      letterSpacing: -0.2,
      lineHeight: 20,
      fontVariant: ['tabular-nums'],
    });
  });

  it('EVM-006 AC6: a single font family string and an opaque shadow color are accepted; unknown types fail', () => {
    expect(mobileValue({ path: ['f'], type: 'fontFamily', value: 'Inter' })).toBe('Inter');
    expect(cssDeclarations({ path: ['f'], type: 'fontFamily', value: 'Segoe UI' })).toEqual([['--evm-f', '"Segoe UI"']]);
    expect(
      mobileValue({
        path: ['s'],
        type: 'shadow',
        value: { color: hex('#112233'), offsetX: px(1), offsetY: px(2), blur: px(4), spread: px(0) },
      }),
    ).toMatchObject({ shadowColor: '#112233', shadowOpacity: 1, elevation: 2 });
    expect(() => mobileValue({ path: ['x'], type: 'gradient', value: [] })).toThrow(/unsupported token type gradient/);
  });

  it('EVM-006 AC6: shadows approximate the strongest layer with shadow* and Android elevation; transitions become objects', () => {
    expect(mobileValue({ path: ['elevation', 'card'], type: 'shadow', value: SHADOW })).toEqual({
      shadowColor: '#000000',
      shadowOpacity: 0.12,
      shadowRadius: 1.5,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    });
    expect(
      mobileValue({ path: ['t'], type: 'transition', value: { duration: ms(200), delay: ms(0), timingFunction: [0, 0, 0, 1] } }),
    ).toEqual({
      duration: 200,
      delay: 0,
      easing: [0, 0, 0, 1],
    });
  });
});
