// @ts-check
/**
 * Static guard (finding F): the tool's own code (cli.mjs, lib/) has no API that writes, moves or deletes files,
 * runs a shell or terminates the process abruptly. Tests and helpers are excluded — they build fixtures.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = fileURLToPath(new URL('..', import.meta.url));
const SOURCES = ['cli.mjs', ...readdirSync(join(TOOL_DIR, 'lib')).map((name) => `lib/${name}`)].filter((path) => path.endsWith('.mjs'));

/** @param {string} path */
const source = (path) => readFileSync(join(TOOL_DIR, ...path.split('/')), 'utf8');

/**
 * Names imported from a module specifier, e.g. `import { a, b } from 'node:fs'` → ['a', 'b'].
 * @param {string} text
 * @param {string} specifier
 * @returns {string[]}
 */
function importedNames(text, specifier) {
  const names = [];
  const pattern = new RegExp(`import\\s+([^;]*?)\\s+from\\s+'${specifier}'`, 'g');
  for (const match of text.matchAll(pattern)) {
    assert.match(match[1], /^\{[^}]*\}$/, `tylko importy nazwane z ${specifier}: ${match[1]}`);
    names.push(
      ...match[1]
        .slice(1, -1)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    );
  }
  return names;
}

describe('narzędzie tylko czyta (EVM-012 AC5, ustalenie F)', () => {
  it('EVM-012 AC5: kod narzędzia obejmuje cli.mjs i moduły lib/', () => {
    assert.ok(SOURCES.includes('cli.mjs'));
    assert.ok(SOURCES.includes('lib/repository.mjs'));
    assert.ok(SOURCES.length >= 10);
  });

  it('EVM-012 AC5: z node:fs importowane są wyłącznie lstatSync i readFileSync; bez fs/promises i require', () => {
    for (const path of SOURCES) {
      const text = source(path);
      for (const name of importedNames(text, 'node:fs')) {
        assert.ok(['lstatSync', 'readFileSync'].includes(name), `${path}: niedozwolony import z node:fs — ${name}`);
      }
      assert.doesNotMatch(text, /from\s+'(?:node:)?fs\/promises'|from\s+'fs'|require\s*\(/, path);
    }
  });

  it('EVM-012 AC5: brak wywołań zapisujących, przenoszących lub usuwających pliki', () => {
    const writes =
      /\b(?:writeFile|appendFile|createWriteStream|rm|rmdir|unlink|rename|mkdir|mkdtemp|copyFile|cp|truncate|chmod|chown|symlink|link|utimes|lutimes|opendir)(?:Sync)?\s*\(/;
    for (const path of SOURCES) assert.doesNotMatch(source(path), writes, path);
  });

  it('EVM-012 AC5: git wyłącznie przez execFileSync (bez powłoki) z listą dozwolonych poleceń', () => {
    for (const path of SOURCES) {
      const text = source(path);
      const names = importedNames(text, 'node:child_process');
      if (names.length > 0) assert.equal(path, 'lib/repository.mjs');
      for (const name of names) assert.equal(name, 'execFileSync', `${path}: ${name}`);
      assert.doesNotMatch(text, /shell\s*:\s*true/, path);
    }
    assert.match(source('lib/repository.mjs'), /new Set\(\['rev-parse', 'ls-files', 'check-ignore'\]\)/);
  });

  it('EVM-012 AC3: process.exitCode zamiast process.exit() (pełne wyjście w potoku)', () => {
    for (const path of SOURCES) assert.doesNotMatch(source(path), /process\.exit\s*\(/, path);
    assert.match(source('cli.mjs'), /process\.exitCode = main\(/);
  });
});
