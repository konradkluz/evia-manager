import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { i18next } from '../src/i18n';
import { pl } from '../src/i18n/pl';

const SOURCES = join(__dirname, '..', 'src');

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

function leaves(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('Polish catalogue (EVM-009 AC1: texts through i18n pl)', () => {
  it('EVM-009 AC1: the language is Polish and every key used in the source exists in the catalogue', () => {
    expect(i18next.language).toBe('pl');
    const used = new Set<string>();
    for (const path of files(SOURCES)) {
      for (const match of readFileSync(path, 'utf8').matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)) used.add(match[1] ?? '');
    }
    expect(used.size).toBeGreaterThan(15);
    expect([...used].filter((key) => !i18next.exists(key))).toEqual([]);
  });

  it('EVM-009 AC1: every text of the catalogue is used by the source (no dead copy)', () => {
    const source = files(SOURCES)
      .filter((path) => !path.endsWith(join('i18n', 'pl.ts')))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(leaves(pl).filter((key) => !source.includes(`'${key}'`))).toEqual([]);
  });

  it('EVM-009 AC3: the update copy carries the versions as parameters', () => {
    expect(i18next.t('update.versions', { current: '1.2.3', required: '4.5.6' })).toBe('Twoja wersja: 1.2.3 · Wymagana: 4.5.6');
  });
});
