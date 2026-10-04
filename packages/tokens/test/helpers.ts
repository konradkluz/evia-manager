// Synthetic token fixtures written to a temporary directory (EVM-006 AC6). No real data — design tokens only.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Fixture {
  readonly dir: string;
  write(path: string, content: unknown): void;
  dispose(): void;
}

export function fixture(files: Record<string, unknown> = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'evm006-tokens-'));
  const write = (path: string, content: unknown): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  };
  for (const [path, content] of Object.entries(files)) write(path, content);
  return {
    dir,
    write,
    dispose: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const px = (value: number): { value: number; unit: string } => ({ value, unit: 'px' });
export const hex = (value: string, alpha?: number): Record<string, unknown> => ({
  colorSpace: 'srgb',
  components: [0, 0, 0],
  hex: value,
  ...(alpha === undefined ? {} : { alpha }),
});

/** A small, valid token set: base palette and dimensions, semantic aliases. */
export const VALID: Record<string, unknown> = {
  'base/color.tokens.json': {
    palette: { $type: 'color', teal: { '600': { $value: hex('#0D9488') } }, alpha: { 'black-12': { $value: hex('#000000', 0.12) } } },
  },
  'base/dimension.tokens.json': { dimension: { $type: 'dimension', '8': { $value: px(8) }, '16': { $value: px(16) } } },
  'semantic/color.light.tokens.json': {
    color: {
      $type: 'color',
      brand: { $value: '{palette.teal.600}' },
      old: { $deprecated: 'use color.brand', $value: '{palette.teal.600}' },
      retired: { $deprecated: true, bg: { $value: '{palette.teal.600}' } },
    },
  },
  'semantic/size.tokens.json': {
    space: { $type: 'dimension', md: { $value: '{dimension.16}' } },
    radius: { $type: 'dimension', control: { $value: '{dimension.8}' } },
  },
};
