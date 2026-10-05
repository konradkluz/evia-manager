// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createI18n } from '../src/i18n/i18n.ts';
import { pl } from '../src/i18n/pl.ts';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const sources = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((path) => /\.tsx?$/.test(path) && !path.startsWith(`i18n`))
  .map((path) => readFileSync(join(SRC, path), 'utf8'));

function keys(tree: object, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value as object, `${prefix}${key}.`),
  );
}

describe('texts through i18n (EVM-008 AC3; styleguide § 6)', () => {
  it('EVM-008 AC3 all UI strings come from pl i18n resources: every key used in the code exists and every key is used', () => {
    const used = new Set(sources.flatMap((source) => [...source.matchAll(/\bt\('([\w.]+)'/g)].map((match) => match[1])));
    const defined = keys(pl);
    expect([...used].sort()).toEqual([...defined].sort());
  });

  it('EVM-008 AC3 the language is Polish only, without a browser language detector', () => {
    const i18n = createI18n();
    expect(i18n.language).toBe('pl');
    expect(i18n.t('workOrders.empty.title')).toBe('Brak zleceń');
    expect(i18n.t('app.pageTitle', { page: 'Zlecenia' })).toBe('Zlecenia · EVia Manager');
    const manifest = readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8');
    expect(manifest).not.toContain('i18next-browser-languagedetector');
  });

  it('EVM-008 AC3 the document is in Polish and index.html has no inline script and no external resources (CSP)', () => {
    const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
    expect(html).toContain('<html lang="pl">');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\b(src|href)="(https?:)?\/\//);
    expect(html).not.toMatch(/<style|style="/);
  });
});
