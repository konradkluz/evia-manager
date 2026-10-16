// @ts-check
/**
 * Worker side of the timed tests (EVM-013 AC6): a fixed module of named tasks. The main thread passes only the name
 * of a task and its input through `workerData` — never code (no `eval: true`; security-engineer, recommendation d).
 * Time is measured here, inside the worker, so the start-up of the worker is not part of the measurement.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { parseFrontmatter } from '../../lib/frontmatter.mjs';
import { parseRoadmapMilestones } from '../../lib/milestones.mjs';
import { extractPathTokens } from '../../lib/references.mjs';
import { analyzeFiles, codes } from './fixtures.mjs';

/** @type {Record<string, (input: unknown) => unknown>} */
const TASKS = {
  frontmatter: (text) => Object.fromEntries(parseFrontmatter(/** @type {string} */ (text))),
  roadmap: (text) => parseRoadmapMilestones(/** @type {string} */ (text), 'Przegląd'),
  pathTokens: (text) => extractPathTokens(/** @type {string} */ (text)),
  // `input`: files added to the clean base repository of the fixtures.
  analyze: (files) => {
    const analysis = analyzeFiles(/** @type {Record<string, string>} */ (files));
    return { codes: codes(analysis), milestones: analysis.milestones, references: Object.fromEntries(analysis.references) };
  },
  // Controls of the mechanism: computations that never finish — only the hard deadline stops them.
  endlessLoop: () => {
    for (;;) {
      // never ends
    }
  },
  catastrophicRegex: (text) => /^(a+)+$/.test(/** @type {string} */ (text)),
};

/** @type {unknown} */
const data = workerData;
const { task, input } = /** @type {{ task: string, input: unknown }} */ (data);
const run = TASKS[task];
if (run === undefined) throw new Error(`nieznane zadanie: ${task}`);
const started = performance.now();
const result = run(input);
const elapsed = performance.now() - started;
/** @type {import('node:worker_threads').MessagePort} */ (parentPort).postMessage({ elapsed, result });
