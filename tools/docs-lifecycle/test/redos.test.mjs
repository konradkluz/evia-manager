// @ts-check
/**
 * Availability of the gate (EVM-013 AC6; security-engineer L3, CWE-1333, CWE-400): every timed analysis runs in a
 * worker thread with a hard deadline, so a regression fails the test instead of hanging the CI job.
 * Synthetic inputs only.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROADMAP } from './helpers/fixtures.mjs';
import { runTimed } from './helpers/timed-worker.mjs';

/** Limit of one analysis measured inside the worker (AC6; the same as EVM-012 AC4). */
const LIMIT_MS = 2000;
const LONG = 200 * 1024;
/** Line separators that `.` in a regular expression does not match — the trigger of the former backtracking. */
const SEPARATORS = [
  ['U+2028', '\u2028'],
  ['U+2029', '\u2029'],
];

/**
 * Frontmatter with a valid field and the field `klucz:` followed by ~200 KB of spaces and tabs and a line separator.
 * @param {string} separator
 */
const frontmatterBomb = (separator) =>
  ['---', 'lifecycle: living', `klucz:${' \t'.repeat(LONG / 2)}${separator}`, '---', '# Dokument', ''].join('\n');

/**
 * Roadmap of the fixtures with a heading `#` + ~200 KB of spaces + a line separator before and inside „Przegląd”.
 * @param {string} separator
 */
function roadmapBomb(separator) {
  const bomb = `#${' '.repeat(LONG)}${separator}`;
  return `${bomb}\n${ROADMAP.replace('| M2 | Teren | Next |\n', `| M2 | Teren | Next |\n${bomb}\n`)}`;
}

/** Deadline of the control tests — the computation never finishes, only the deadline stops it. */
const CONTROL_DEADLINE_MS = 300;
/** Upper bound for the whole control test: deadline plus stopping the worker (seconds would mean a hang). */
const CONTROL_BOUND_MS = 5000;

describe('pomiar czasu w wątku z twardym terminem (EVM-013 AC6)', () => {
  it('EVM-013 AC6: wynik i czas zmierzony wewnątrz wątku', async () => {
    const { elapsed, result } = await runTimed('pathTokens', 'Zobacz docs/README.md');
    assert.deepEqual(result, ['docs/README.md']);
    assert.equal(typeof elapsed, 'number');
    assert.ok(elapsed >= 0 && elapsed < 2000, `czas ${Math.round(elapsed)} ms`);
  });

  for (const [task, input, what] of [
    ['endlessLoop', null, 'pętla'],
    ['catastrophicRegex', `${'a'.repeat(64)}!`, 'wyrażenie regularne z katastrofalnym nawracaniem'],
  ]) {
    it(`EVM-013 AC6: test kontrolny — obliczenie bez końca (${what}) jest przerwane po twardym terminie z komunikatem o przekroczeniu czasu`, async () => {
      const started = performance.now();
      await assert.rejects(runTimed(String(task), input, { deadlineMs: CONTROL_DEADLINE_MS }), {
        message: `przekroczono twardy termin ${CONTROL_DEADLINE_MS} ms — wątek przerwany (worker.terminate)`,
      });
      const total = performance.now() - started;
      assert.ok(total < CONTROL_BOUND_MS, `przerwanie trwało ${Math.round(total)} ms (limit ${CONTROL_BOUND_MS} ms)`);
    });
  }

  it('EVM-013 AC6: błąd zadania w wątku i nieznane zadanie kończą pomiar błędem (bez czekania na termin)', async () => {
    await assert.rejects(runTimed('frontmatter', null), { name: 'TypeError' });
    await assert.rejects(runTimed('brak-takiego-zadania', null), { message: 'nieznane zadanie: brak-takiego-zadania' });
  });
});

describe('wyrażenia bez katastrofalnego nawracania — pliki 200 KB (EVM-013 AC6, ustalenie L3)', () => {
  for (const [name, separator] of SEPARATORS) {
    it(`EVM-013 AC6: frontmatter — pole klucz: z ok. 200 KB spacji i tabulatorów zakończonych ${name} — analiza < 2 s (pomiar w wątku)`, async () => {
      const { elapsed, result } = await runTimed('frontmatter', frontmatterBomb(separator));
      assert.ok(elapsed < LIMIT_MS, `analiza trwała ${Math.round(elapsed)} ms (limit ${LIMIT_MS} ms)`);
      // A line with a line separator inside the value is not a field — as before the fix.
      assert.deepEqual(result, { lifecycle: 'living' });
    });

    it(`EVM-013 AC6: roadmapa — nagłówek # z ok. 200 KB spacji zakończonych ${name} — analiza < 2 s (pomiar w wątku)`, async () => {
      const { elapsed, result } = await runTimed('roadmap', roadmapBomb(separator));
      assert.ok(elapsed < LIMIT_MS, `analiza trwała ${Math.round(elapsed)} ms (limit ${LIMIT_MS} ms)`);
      assert.deepEqual(result, ['M0', 'M1', 'M2']);
    });

    it(`EVM-013 AC6: pełna analiza repozytorium z oboma plikami (${name}) — < 2 s, wynik bez zmian`, async () => {
      const { elapsed, result } = await runTimed('analyze', {
        'docs/product/roadmap.md': roadmapBomb(separator),
        'docs/product/dlugi.md': frontmatterBomb(separator),
        'docs/README.md': '# Dokumentacja\n- process/workflow.md\n- product/roadmap.md\n- product/dlugi.md\n',
      });
      assert.ok(elapsed < LIMIT_MS, `analiza trwała ${Math.round(elapsed)} ms (limit ${LIMIT_MS} ms)`);
      assert.deepEqual(result.codes, []);
      assert.deepEqual(result.milestones, ['M0', 'M1', 'M2']);
    });
  }
});
