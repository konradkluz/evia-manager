// @ts-check
/**
 * Synthetic documents for EVM-012 tests (no real project or customer data).
 * `memoryRepo` gives the analysis an in-memory file set; `createTempRepo` (temp-repo.mjs)
 * writes the same files to a real git repository when git behaviour matters.
 */
import { loadConfig } from '../../lib/config.mjs';
import { analyze } from '../../lib/analyze.mjs';

export const TODAY = '2026-10-02';

export const ROADMAP = [
  '# Roadmapa (syntetyczna)',
  '',
  '## Przegląd',
  '| Kamień | Nazwa | Horyzont |',
  '|---|---|---|',
  '| **M0** | Fundamenty | Now |',
  '| **M1** | MVP | Now |',
  '| M2 | Teren | Next |',
  '',
  '## M0 — Fundamenty',
  '| Kamień | Pozycja |',
  '|---|---|',
  '| M9 | wiersz poza tabelą „Przegląd” — to nie jest kamień milowy |',
  '',
].join('\n');

/**
 * @param {Record<string, string | undefined>} fields frontmatter fields (undefined = omitted)
 * @param {string} [body]
 * @returns {string}
 */
export function doc(fields, body = '# Dokument\n') {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return lines.length === 0 ? body : ['---', ...lines, '---', body].join('\n');
}

/**
 * @param {string} id
 * @param {string | undefined} milestone
 * @param {string} [status]
 */
export function story(id, milestone, status = 'in-progress') {
  return doc({ id, title: 'Przykładowa historyjka', milestone, status }, `# ${id}\n`);
}

/** A clean repository: every file classified, no errors, no warnings. */
export function baseFiles() {
  return {
    'README.md': '# Projekt\nDokumentacja: docs/README.md\n',
    'docs/README.md': '# Dokumentacja\n- [Workflow](process/workflow.md)\n- `product/roadmap.md`\n',
    'docs/product/roadmap.md': ROADMAP,
    'docs/process/workflow.md': '# Workflow\n',
    'docs/backlog/M0/EVM-001-przyklad.md': story('EVM-001', 'M0', 'done'),
    'docs/backlog/M1/EVM-101-przyklad.md': story('EVM-101', 'M1'),
  };
}

/**
 * @param {Record<string, string>} files `.md` (and other) files with content
 * @param {{ extraPaths?: string[], scratchIgnored?: boolean }} [options] extra non-read paths (e.g. spike code)
 * @returns {import('../../lib/analyze.mjs').RepositoryFiles}
 */
export function memoryRepo(files, { extraPaths = [], scratchIgnored = true } = {}) {
  return {
    paths: [...Object.keys(files), ...extraPaths],
    read: (path) => (Object.hasOwn(files, path) ? files[path] : null),
    scratchIgnored,
  };
}

export const config = loadConfig();

/**
 * Analysis of an in-memory repository: base files + overrides.
 * @param {Record<string, string>} files
 * @param {{ extraPaths?: string[], scratchIgnored?: boolean, today?: string, base?: boolean }} [options]
 */
export function analyzeFiles(files, { extraPaths, scratchIgnored, today = TODAY, base = true } = {}) {
  const all = base ? { ...baseFiles(), ...files } : files;
  return analyze(memoryRepo(all, { extraPaths, scratchIgnored }), { config, today });
}

/**
 * One synthetic violation of every error code and both warnings (EVM-013 AC7: the dictionary of errors and the
 * „błędy klasy” flag), in a repository whose scratch directory is not ignored.
 * @returns {import('../../lib/analyze.mjs').Analysis}
 */
export function analyzeEveryFinding() {
  return analyzeFiles(
    {
      'notatka.md': '# Luźna notatka\n',
      'docs/notes/bez-klasy.md': '# Notatka\n',
      'docs/notes/archiwum.md': doc({ lifecycle: 'archiwum' }),
      'docs/product/sprzeczny.md': doc({ lifecycle: 'permanent' }),
      'docs/qa/EVM-001/raport.md': doc({ milestone: 'M1' }),
      'docs/notes/szkic.md': doc({ lifecycle: 'ephemeral' }),
      '.scratch/robocza.md': '# Robocza\n',
      'docs/notes/plan.md': doc({ lifecycle: 'milestone' }),
      'docs/notes/plan-m9.md': doc({ lifecycle: 'milestone', milestone: 'M9' }),
      'docs/product/data.md': doc({ review_by: '2026-13-01' }),
      'docs/product/cennik.md': doc({ expires: '2027-01-01' }),
      'docs/product/przegląd.md': doc({ review_by: '2026-01-01' }),
      'docs/README.md': '# D\n- process/workflow.md product/roadmap.md product/data.md product/cennik.md product/przegląd.md\n',
    },
    { extraPaths: ['spikes/kolejka/kolejka.ts'], scratchIgnored: false },
  );
}

/**
 * Findings as `code path` strings for compact assertions (finding I: tests check code + path).
 * @param {import('../../lib/analyze.mjs').Analysis} analysis
 * @param {'error' | 'warning'} [severity]
 * @returns {string[]}
 */
export function codes(analysis, severity) {
  return analysis.findings
    .filter((finding) => severity === undefined || finding.severity === severity)
    .map((finding) => `${finding.code} ${finding.path}`);
}
