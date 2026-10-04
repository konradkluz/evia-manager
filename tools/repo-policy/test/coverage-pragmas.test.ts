/**
 * Coverage pragmas (EVM-006 AC3; docs/process/testing-strategy.md → „Progi”): `v8 ignore` only around the process
 * wiring of an entry point (`if (import.meta.main) {`) and always with a reason. Any other pragma hides new uncovered
 * code from the global thresholds and from diff-coverage („Brak mierzalnych zmian” — green). QA, round 2.
 */
import { describe, expect, it } from 'vitest';
import { filesBelow, read, workspaces } from '../src/files.ts';

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /(^|\/)test\/|\.test\.[^/]+$/;
/** Coverage pragmas of V8 (Vitest), c8, Istanbul and node:test. */
const PRAGMA = /\b(?:v8|c8|istanbul)\s+ignore\b|\bnode:coverage\b/;
const START = /^\s*\/\* v8 ignore start -- \S[^*]*\*\/\s*$/;
const STOP = /^\s*\/\* v8 ignore stop \*\/\s*$/;
const ENTRY_POINT = /^\s*if \(import\.meta\.main\) \{\s*$/;

/** Problems of one source file: pragma forms other than an entry-point block with a reason, unbalanced blocks. */
function pragmaProblems(path: string, source: string): string[] {
  const lines = source.split(/\r?\n/);
  const problems: string[] = [];
  let open = false;
  for (const [index, line] of lines.entries()) {
    if (!PRAGMA.test(line)) continue;
    const at = `${path}:${String(index + 1)}`;
    if (START.test(line)) {
      if (open) problems.push(`${at}: zagnieżdżony v8 ignore start`);
      if (!ENTRY_POINT.test(lines[index + 1] ?? '')) problems.push(`${at}: v8 ignore start poza okablowaniem punktu wejścia`);
      open = true;
    } else if (STOP.test(line)) {
      if (!open) problems.push(`${at}: v8 ignore stop bez start`);
      open = false;
    } else {
      problems.push(`${at}: niedozwolony pragmat pokrycia (tylko „v8 ignore start -- <powód>” przed if (import.meta.main))`);
    }
  }
  if (open) problems.push(`${path}: v8 ignore start bez stop`);
  return problems;
}

describe('coverage pragmas (EVM-006 AC3, testing-strategy.md)', () => {
  it('EVM-006 AC3: the checker accepts only a reasoned block around the entry point', () => {
    const wiring = ['/* v8 ignore start -- process wiring */', 'if (import.meta.main) {', '  run();', '}', '/* v8 ignore stop */'];
    expect(pragmaProblems('ok.ts', wiring.join('\n'))).toEqual([]);
    expect(pragmaProblems('crlf.ts', wiring.join('\r\n'))).toEqual([]);
  });

  it('EVM-006 AC3: the checker rejects pragmas that would hide uncovered code', () => {
    const cases: Record<string, string> = {
      'no-reason.ts': '/* v8 ignore start */\nif (import.meta.main) {\n}\n/* v8 ignore stop */\n',
      'not-entry.ts': '/* v8 ignore start -- lazy */\nexport function hidden() {}\n/* v8 ignore stop */\n',
      'next.ts': '/* v8 ignore next */\nexport const x = 1;\n',
      'else.ts': 'if (a) {\n} /* v8 ignore else -- x */ else {\n}\n',
      'c8.ts': '/* c8 ignore next */\nexport const x = 1;\n',
      'istanbul.js': '/* istanbul ignore next */\nexport const x = 1;\n',
      'node.mjs': '/* node:coverage disable */\nexport const x = 1;\n/* node:coverage enable */\n',
      'unclosed.ts': '/* v8 ignore start -- wiring */\nif (import.meta.main) {\n}\n',
      'stray-stop.ts': 'export const x = 1;\n/* v8 ignore stop */\n',
    };
    for (const [path, source] of Object.entries(cases)) expect(pragmaProblems(path, source), path).not.toEqual([]);
  });

  it('EVM-006 AC3: every workspace uses coverage pragmas only around entry-point wiring, with a reason', () => {
    const sources = workspaces().flatMap((workspace) => filesBelow(workspace, (path) => SOURCE.test(path) && !TEST.test(path)));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.flatMap((path) => pragmaProblems(path, read(path)))).toEqual([]);
  });
});
