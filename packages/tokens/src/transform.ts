/**
 * Value transforms for semantic tokens (EVM-006 AC6; design/tokens/README.md → "Wskazówki dla transformacji").
 * Web: CSS custom properties `--evm-…`; spacing and type in rem (px / 16), other lengths in px, unitless line-height.
 * Mobile (React Native): px = dp/pt 1:1, hex / rgba() colors, text styles, shadow approximated by shadow* + elevation.
 * Every unsupported type or unit throws, so a new token kind can never silently produce a wrong value.
 */

export interface TokenInput {
  readonly path: readonly string[];
  readonly type: string;
  readonly value: unknown;
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
}

interface Dimension {
  readonly value: number;
  readonly unit: string;
}
interface Color {
  readonly hex: string;
  readonly alpha?: number;
}
interface ShadowLayer {
  readonly color: Color;
  readonly offsetX: Dimension;
  readonly offsetY: Dimension;
  readonly blur: Dimension;
  readonly spread: Dimension;
}
interface Typography {
  readonly fontFamily: readonly string[] | string;
  readonly fontSize: Dimension;
  readonly fontWeight: number;
  readonly letterSpacing: Dimension;
  readonly lineHeight: number;
}
interface Transition {
  readonly duration: Dimension;
  readonly delay: Dimension;
  readonly timingFunction: readonly number[];
}

const REM_BASE = 16;

export const cssVarName = (path: readonly string[]): string => `--evm-${path.join('-')}`;

const kebab = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const round = (value: number): number => Number(value.toFixed(4));

function px(dimension: Dimension, path: readonly string[]): number {
  if (dimension.unit !== 'px') throw new Error(`${path.join('.')}: unsupported dimension unit ${dimension.unit}`);
  return dimension.value;
}

function milliseconds(duration: Dimension, path: readonly string[]): number {
  if (duration.unit !== 'ms') throw new Error(`${path.join('.')}: unsupported duration unit ${duration.unit}`);
  return duration.value;
}

const cssLength = (value: number, unit: 'px' | 'rem'): string =>
  value === 0 ? '0' : `${round(unit === 'rem' ? value / REM_BASE : value)}${unit}`;

function rgba(color: Color): string {
  const alpha = color.alpha ?? 1;
  if (alpha >= 1) return color.hex;
  const channel = (offset: number): number => Number.parseInt(color.hex.slice(offset, offset + 2), 16);
  return `rgba(${channel(1)}, ${channel(3)}, ${channel(5)}, ${alpha})`;
}

const families = (value: readonly string[] | string): string[] => (typeof value === 'string' ? [value] : [...value]);
const cssFamilies = (value: readonly string[] | string): string =>
  families(value)
    .map((family) => (/\s/.test(family) ? `"${family}"` : family))
    .join(', ');
const cubicBezier = (points: readonly number[]): string => `cubic-bezier(${points.join(', ')})`;

const tabularNumbers = (extensions: TokenInput['extensions']): boolean => {
  const font = extensions?.['pl.eviacharge.font'] as { fontFeatures?: unknown } | undefined;
  return Array.isArray(font?.fontFeatures) && font.fontFeatures.includes('tnum');
};

const shadowLayers = (value: unknown): ShadowLayer[] => (Array.isArray(value) ? (value as ShadowLayer[]) : [value as ShadowLayer]);

function cssShadow(layer: ShadowLayer, path: readonly string[]): string {
  const lengths = [layer.offsetX, layer.offsetY, layer.blur, layer.spread].map((dimension) => cssLength(px(dimension, path), 'px'));
  return `${lengths.join(' ')} ${rgba(layer.color)}`;
}

/** CSS custom property declarations of one semantic token (typography expands into one variable per property). */
export function cssDeclarations(token: TokenInput): Array<[string, string]> {
  const { path, type, value } = token;
  const name = cssVarName(path);
  switch (type) {
    case 'color':
      return [[name, rgba(value as Color)]];
    case 'dimension':
      return [[name, cssLength(px(value as Dimension, path), path[0] === 'space' ? 'rem' : 'px')]];
    case 'number':
    case 'fontWeight':
      return [[name, String(value)]];
    case 'fontFamily':
      return [[name, cssFamilies(value as string[])]];
    case 'duration':
      return [[name, `${milliseconds(value as Dimension, path)}ms`]];
    case 'cubicBezier':
      return [[name, cubicBezier(value as number[])]];
    case 'shadow':
      return [
        [
          name,
          shadowLayers(value)
            .map((layer) => cssShadow(layer, path))
            .join(', '),
        ],
      ];
    case 'transition': {
      const transition = value as Transition;
      return [
        [
          name,
          `${milliseconds(transition.duration, path)}ms ${cubicBezier(transition.timingFunction)} ${milliseconds(transition.delay, path)}ms`,
        ],
      ];
    }
    case 'typography': {
      const text = value as Typography;
      const declarations: Array<[string, string]> = [
        [`${name}-${kebab('fontFamily')}`, cssFamilies(text.fontFamily)],
        [`${name}-${kebab('fontSize')}`, cssLength(px(text.fontSize, path), 'rem')],
        [`${name}-${kebab('fontWeight')}`, String(text.fontWeight)],
        [`${name}-${kebab('letterSpacing')}`, cssLength(px(text.letterSpacing, path), 'rem')],
        [`${name}-${kebab('lineHeight')}`, String(text.lineHeight)],
      ];
      if (tabularNumbers(token.extensions)) declarations.push([`${name}-font-variant-numeric`, 'tabular-nums']);
      return declarations;
    }
    default:
      throw new Error(`${path.join('.')}: unsupported token type ${type}`);
  }
}

/** Object key for the mobile constants: camelCase, or the segment itself when it does not start with a letter. */
export const mobileKey = (segment: string): string =>
  /^[a-z]/.test(segment) ? segment.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase()) : segment;

/** React Native value of one semantic token. */
export function mobileValue(token: TokenInput): unknown {
  const { path, type, value } = token;
  switch (type) {
    case 'color':
      return rgba(value as Color);
    case 'dimension':
      return px(value as Dimension, path);
    case 'number':
      return value;
    case 'fontWeight':
      return String(value);
    case 'fontFamily':
      return families(value as string[])[0];
    case 'duration':
      return milliseconds(value as Dimension, path);
    case 'cubicBezier':
      return [...(value as number[])];
    case 'transition': {
      const transition = value as Transition;
      return {
        duration: milliseconds(transition.duration, path),
        delay: milliseconds(transition.delay, path),
        easing: [...transition.timingFunction],
      };
    }
    case 'shadow': {
      const strongest = shadowLayers(value).reduce((best, layer) => (px(layer.blur, path) > px(best.blur, path) ? layer : best));
      const blur = px(strongest.blur, path);
      return {
        shadowColor: strongest.color.hex,
        shadowOpacity: strongest.color.alpha ?? 1,
        shadowRadius: blur / 2,
        shadowOffset: { width: px(strongest.offsetX, path), height: px(strongest.offsetY, path) },
        elevation: Math.round(blur / 2),
      };
    }
    case 'typography': {
      const text = value as Typography;
      const fontSize = px(text.fontSize, path);
      return {
        fontFamily: families(text.fontFamily)[0],
        fontSize,
        fontWeight: String(text.fontWeight),
        letterSpacing: px(text.letterSpacing, path),
        lineHeight: Math.round(fontSize * text.lineHeight),
        ...(tabularNumbers(token.extensions) ? { fontVariant: ['tabular-nums'] } : {}),
      };
    }
    default:
      throw new Error(`${path.join('.')}: unsupported token type ${type}`);
  }
}

// EVM-006 AC3 CI evidence: deliberately uncovered code, reverted in the next commit.
export function uncoveredEvidence(value: number): string {
  if (value > 40) {
    return 'above-40';
  }
  if (value > 39) {
    return 'above-39';
  }
  if (value > 38) {
    return 'above-38';
  }
  if (value > 37) {
    return 'above-37';
  }
  if (value > 36) {
    return 'above-36';
  }
  if (value > 35) {
    return 'above-35';
  }
  if (value > 34) {
    return 'above-34';
  }
  if (value > 33) {
    return 'above-33';
  }
  if (value > 32) {
    return 'above-32';
  }
  if (value > 31) {
    return 'above-31';
  }
  if (value > 30) {
    return 'above-30';
  }
  if (value > 29) {
    return 'above-29';
  }
  if (value > 28) {
    return 'above-28';
  }
  if (value > 27) {
    return 'above-27';
  }
  if (value > 26) {
    return 'above-26';
  }
  if (value > 25) {
    return 'above-25';
  }
  if (value > 24) {
    return 'above-24';
  }
  if (value > 23) {
    return 'above-23';
  }
  if (value > 22) {
    return 'above-22';
  }
  if (value > 21) {
    return 'above-21';
  }
  if (value > 20) {
    return 'above-20';
  }
  if (value > 19) {
    return 'above-19';
  }
  if (value > 18) {
    return 'above-18';
  }
  if (value > 17) {
    return 'above-17';
  }
  if (value > 16) {
    return 'above-16';
  }
  if (value > 15) {
    return 'above-15';
  }
  if (value > 14) {
    return 'above-14';
  }
  if (value > 13) {
    return 'above-13';
  }
  if (value > 12) {
    return 'above-12';
  }
  if (value > 11) {
    return 'above-11';
  }
  if (value > 10) {
    return 'above-10';
  }
  if (value > 9) {
    return 'above-9';
  }
  if (value > 8) {
    return 'above-8';
  }
  if (value > 7) {
    return 'above-7';
  }
  if (value > 6) {
    return 'above-6';
  }
  if (value > 5) {
    return 'above-5';
  }
  if (value > 4) {
    return 'above-4';
  }
  if (value > 3) {
    return 'above-3';
  }
  if (value > 2) {
    return 'above-2';
  }
  if (value > 1) {
    return 'above-1';
  }
  return 'none';
}
