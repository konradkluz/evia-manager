// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const STYLES = fileURLToPath(new URL('../src/styles.css', import.meta.url));
const source = readFileSync(STYLES, 'utf8');
const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
const tokensCss = readFileSync(require.resolve('@evia/tokens/web.css'), 'utf8');
const definedTokens = new Set([...tokensCss.matchAll(/^\s*(--evm-[\w-]+):/gm)].map((match) => match[1]));

/** Tailwind compiler with @import resolved from this package (the same resolution as Vite in apps/web). */
async function build(candidates: string[]): Promise<string> {
  const compiler = await compile(source, {
    base: dirname(STYLES),
    loadStylesheet: (id, base) => {
      const path = id.startsWith('.') ? resolve(base, id) : require.resolve(id);
      return Promise.resolve({ path, base: dirname(path), content: readFileSync(path, 'utf8') });
    },
  });
  return compiler.build(candidates);
}

describe('Tailwind theme from design tokens (EVM-008 AC3; styleguide § 7.2, ADR-0006)', () => {
  let css: string;
  beforeAll(async () => {
    css = await build([
      'bg-bg-canvas',
      'gap-stack-md',
      'w-sidebar-width-expanded',
      'expanded:w-sidebar-width-expanded',
      'medium:max-expanded:opacity-0',
      'text-heading-3',
      'font-display',
      'focus-visible:focus-ring',
      'px-grid-wide-margin',
      'm-0',
      'inset-y-0',
      'border-w-default',
      'border-w-strong',
      'animate-skeleton',
      'z-dropdown',
      'z-toast',
      'focus-visible:focus-ring-inner',
      'border-s-indicator-error',
      'max-w-form-max-width',
      'shadow-dropdown',
      'max-w-dialog-width-sm',
      'rounded-dialog',
      'shadow-dialog',
      'text-body-sm',
      // Not tokens — must generate nothing:
      'p-4',
      'text-red-500',
      'bg-white',
      'w-64',
      'shadow-lg',
      'md:flex',
    ]);
  });

  it('EVM-008 AC3 styles use tokens only: no literal colours or lengths in the stylesheet', () => {
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(withoutComments).not.toMatch(/\b(rgba?|hsla?|oklch|oklab)\(/);
    expect(withoutComments).not.toMatch(/\b\d+(\.\d+)?(px|rem|em|vh|vw|pt|ms|s)\b/);
    expect(withoutComments).not.toMatch(/font-family:(?!\s*var\()/);
    // Tailwind's default theme (palette, spacing scale, breakpoints) is never imported.
    expect(withoutComments).not.toMatch(/@import 'tailwindcss'|tailwindcss\/theme|tailwindcss\/index/);
  });

  it('EVM-008 AC3 every theme value is a semantic token of @evia/tokens that exists', () => {
    const theme = /@theme inline \{([\s\S]*?)\n\}/.exec(withoutComments)?.[1] ?? '';
    const entries = [...theme.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)];
    expect(entries.length).toBeGreaterThan(30);
    // Zero is the only literal allowed by styleguide § 7.2.
    for (const [, name, value] of entries) expect(value, name).toMatch(name === '--spacing-0' ? /^0$/ : /^var\(--evm-[\w-]+\)$/);
    const used = [...withoutComments.matchAll(/var\((--evm-[\w-]+)\)/g)].map((match) => match[1]);
    for (const token of used) expect(definedTokens.has(token), token).toBe(true);
  });

  it('EVM-008 AC3 token utilities are generated; utilities outside the tokens are not', () => {
    expect(css).toContain('background-color: var(--evm-color-bg-canvas)');
    expect(css).toContain('gap: var(--evm-space-stack-md)');
    expect(css).toContain('width: var(--evm-size-sidebar-width-expanded)');
    expect(css).toContain('@media (width >= 1280px)');
    expect(css).toMatch(/@media \(width >= 768px\)[\s\S]*@media \(width < 1280px\)/);
    expect(css).toContain('font-size: var(--evm-text-heading-3-font-size)');
    expect(css).toContain('font-family: var(--evm-text-heading-1-font-family)');
    expect(css).toContain('outline: var(--evm-size-focus-ring-width) solid var(--evm-color-focus-ring)');
    expect(css).toContain('padding-inline: var(--spacing-grid-wide-margin)');
    expect(css).toMatch(/\.m-0 \{\s*margin: 0;/);
    expect(css).toMatch(/\.inset-y-0 \{\s*inset-block: 0;/);
    expect(css).toMatch(/\.border-w-default \{[^}]*border-width: var\(--evm-border-width-default\)/);
    expect(css).toMatch(/\.border-w-strong \{[^}]*border-width: var\(--evm-border-width-strong\)/);
    expect(css).toContain('animation: skeleton var(--evm-motion-duration-skeleton) var(--evm-motion-easing-linear) infinite');
    expect(css).toMatch(/@keyframes skeleton \{[^}]*background-color: var\(--evm-color-bg-skeleton-highlight\)/);
    expect(css).toContain('z-index: var(--evm-layer-dropdown)');
    expect(css).toContain('outline-offset: calc(var(--evm-size-focus-ring-width) * -1)');
    expect(css).toContain('border-inline-start: var(--evm-border-width-indicator) solid var(--evm-color-feedback-error-border)');
    expect(css).toContain('max-width: var(--evm-size-form-max-width)');
    expect(css).toContain('--tw-shadow: var(--evm-elevation-dropdown)');
    expect(css).toContain('max-width: var(--evm-size-dialog-width-sm)');
    expect(css).toContain('border-radius: var(--evm-radius-dialog)');
    expect(css).toContain('--tw-shadow: var(--evm-elevation-dialog)');
    for (const name of ['.p-4', '.text-red-500', '.bg-white', '.w-64', '.shadow-lg', '.md\\:flex']) expect(css, name).not.toContain(name);
  });
});
