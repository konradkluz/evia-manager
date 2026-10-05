// @ts-check
/**
 * Availability of the gate (EVM-013 AC6; security-engineer L3, CWE-1333, CWE-400): every timed analysis runs in a
 * worker thread with a hard deadline, so a regression fails the test instead of hanging the CI job.
 * Synthetic inputs only.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runTimed } from './helpers/timed-worker.mjs';

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
