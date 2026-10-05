// @ts-check
/**
 * Step summary of the documentation gate in CI (EVM-013 AC2, AC3, AC5): `check --summary` writes Markdown for the
 * GitHub step summary to stdout and the unchanged report to stderr (the log). A fixed structure of trusted texts and
 * numbers; values from the repository only inside fenced code blocks; at most 100 entries per list and 400 KiB per
 * block. Synthetic data only.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildCleanupReport } from '../lib/cleanup.mjs';
import { formatCheck, formatCleanupReport, formatSummary, SUMMARY_LIMITS } from '../lib/format.mjs';
import { EXIT } from '../lib/main.mjs';
import { runCli, runMain } from './helpers/cli.mjs';
import { analyzeFiles, baseFiles, doc } from './helpers/fixtures.mjs';
import { createTempRepo } from './helpers/temp-repo.mjs';

const POLICY = 'docs/process/document-lifecycle.md';
const MIB = 1024 * 1024;

/** Lines allowed outside the code blocks: constant texts, numbers and the day (security-engineer, recommendation e). */
const TEMPLATE = [
  /^### Walidator dokumentacji \(EVM-013\)$/,
  /^$/,
  /^Wynik: błędy \(\d+\) — popraw je przed oddaniem przyrostu$/,
  /^Wynik: brak błędów; ostrzeżenia \(\d+\) do przejrzenia — nie blokują$/,
  /^Wynik: brak błędów i ostrzeżeń — dokumentacja zgodna z polityką$/,
  /^błędy: \d+ · ostrzeżenia: \d+$/,
  /^Dzień: \d{4}-\d{2}-\d{2} \(Europe\/Warsaw\) · plików \.md: \d+$/,
  /^#### (?:Błędy|Ostrzeżenia) \(\d+\)$/,
  /^brak$/,
  /^… i \d+ więcej — pełna lista w logu$/,
  /^Pełna lista ustaleń — w logu kroku\. Powtórz sprawdzenie lokalnie: `npm run docs:check`\.$/,
];

/**
 * A step summary split as a CommonMark renderer sees it: lines outside fenced code blocks and the blocks (a block ends
 * at the first line of at most 3 spaces and at least as many backticks as its opening fence).
 * @param {string} markdown
 * @returns {{ outside: string[], blocks: Array<{ fence: string, lines: string[] }> }}
 */
function parseSummary(markdown) {
  assert.ok(markdown.endsWith('\n'), 'podsumowanie kończy się znakiem nowej linii');
  /** @type {string[]} */
  const outside = [];
  /** @type {Array<{ fence: string, lines: string[] }>} */
  const blocks = [];
  /** @type {{ fence: string, lines: string[] } | null} */
  let open = null;
  for (const line of markdown.slice(0, -1).split('\n')) {
    if (open === null) {
      const start = /^(`{3,})text$/.exec(line);
      if (start) {
        open = { fence: start[1], lines: [] };
        blocks.push(open);
      } else {
        outside.push(line);
      }
      continue;
    }
    const close = /^ {0,3}(`+)[ \t]*$/.exec(line);
    if (close && close[1].length >= open.fence.length) open = null;
    else open.lines.push(line);
  }
  assert.equal(open, null, 'każdy blok kodu jest zamknięty');
  return { outside, blocks };
}

/**
 * @param {string[]} lines
 * @returns {string[]} lines outside the template (empty when the structure is intact)
 */
const offTemplate = (lines) => lines.filter((line) => !TEMPLATE.some((pattern) => pattern.test(line)));

/** @param {string} text */
const longestBacktickRun = (text) => Math.max(0, ...Array.from(text.matchAll(/`+/g), ([run]) => run.length));

describe('podsumowanie przebiegu — struktura (EVM-013 AC2, AC5)', () => {
  it('EVM-013 AC5: błędy i ostrzeżenia — nagłówek, wynik, licznik, dzień, listy w blokach kodu i podpowiedź npm run docs:check', () => {
    const analysis = analyzeFiles({ 'notatka.md': '# N\n', 'docs/product/zapomniany.md': '# Z\n' });
    const [error] = formatCheck(analysis, { list: false, policy: POLICY }).split('\n');
    assert.ok(error.startsWith('BŁĄD · notatka.md · — · '));
    assert.equal(
      formatSummary(analysis),
      [
        '### Walidator dokumentacji (EVM-013)',
        '',
        'Wynik: błędy (1) — popraw je przed oddaniem przyrostu',
        '',
        'błędy: 1 · ostrzeżenia: 1',
        '',
        'Dzień: 2026-10-02 (Europe/Warsaw) · plików .md: 8',
        '',
        '#### Błędy (1)',
        '',
        '```text',
        error.slice('BŁĄD · '.length),
        '```',
        '',
        '#### Ostrzeżenia (1)',
        '',
        '```text',
        `docs/product/zapomniany.md · żywy · ${String(analysis.findings[1]?.reason)}`,
        '```',
        '',
        'Pełna lista ustaleń — w logu kroku. Powtórz sprawdzenie lokalnie: `npm run docs:check`.',
        '',
      ].join('\n'),
    );
  });

  it('EVM-013 AC2: same ostrzeżenia — wynik bez błędów, licznik błędy: 0 · ostrzeżenia: N, lista ostrzeżeń, lista błędów „brak”', () => {
    const summary = formatSummary(analyzeFiles({ 'docs/product/a.md': '# A\n', 'docs/product/b.md': '# B\n' }));
    const { outside, blocks } = parseSummary(summary);
    assert.deepEqual(offTemplate(outside), []);
    assert.ok(outside.includes('Wynik: brak błędów; ostrzeżenia (2) do przejrzenia — nie blokują'));
    assert.ok(outside.includes('błędy: 0 · ostrzeżenia: 2'));
    assert.deepEqual(outside.slice(outside.indexOf('#### Błędy (0)'), outside.indexOf('#### Błędy (0)') + 3), [
      '#### Błędy (0)',
      '',
      'brak',
    ]);
    assert.equal(blocks.length, 1);
    assert.deepEqual(
      blocks[0]?.lines.map((line) => line.split(' · ').slice(0, 2).join(' · ')),
      ['docs/product/a.md · żywy', 'docs/product/b.md · żywy'],
    );
  });

  it('EVM-013 AC2: czysta dokumentacja — jednoznaczny komunikat, obie listy „brak”, bez bloków kodu', () => {
    const summary = formatSummary(analyzeFiles({}));
    const { outside, blocks } = parseSummary(summary);
    assert.deepEqual(blocks, []);
    assert.deepEqual(offTemplate(outside), []);
    assert.ok(outside.includes('Wynik: brak błędów i ostrzeżeń — dokumentacja zgodna z polityką'));
    assert.ok(outside.includes('błędy: 0 · ostrzeżenia: 0'));
    assert.equal(outside.filter((line) => line === 'brak').length, 2);
  });
});

describe('podsumowanie przebiegu — bezpieczeństwo i limity (EVM-013 AC5; kontrola 5, zalecenie e)', () => {
  /** Synthetic paths with Markdown and HTML that must stay literal text. */
  const HOSTILE = [
    'docs/product/a`b.md',
    'docs/product/c``d``e.md',
    'docs/product/f|g|h.md',
    'docs/product/<img src=x onerror=alert(1)>.md',
    'docs/product/[a](https://example.invalid).md',
    'docs/product/![x](https://example.invalid/x.png).md',
    'docs/product/**pogrubienie** _kursywa_.md',
    'docs/product/@syntetyczny-uzytkownik.md',
    'docs/product/### Wynik: brak błędów i ostrzeżeń — dokumentacja zgodna z polityką.md',
    'docs/product/```text.md',
  ];

  it('EVM-013 AC5: ścieżki z backtickami, |, HTML, linkiem, obrazem, ** i wzmianką — dosłownie w bloku kodu, struktura nienaruszona', () => {
    const summary = formatSummary(analyzeFiles(Object.fromEntries(HOSTILE.map((path) => [path, '# X\n']))));
    const { outside, blocks } = parseSummary(summary);
    assert.deepEqual(offTemplate(outside), []);
    const shown = blocks.flatMap((block) => block.lines);
    for (const path of HOSTILE) {
      assert.ok(
        shown.some((line) => line.startsWith(`${path} · `)),
        `ścieżka poza blokiem kodu albo zmieniona: ${path}`,
      );
    }
    for (const block of blocks) {
      assert.ok(block.fence.length > longestBacktickRun(block.lines.join('\n')), 'płotek dłuższy od serii backticków');
      assert.ok(block.fence.length >= 3);
    }
  });

  it('EVM-013 AC5: ponad 100 błędów i ponad 100 ostrzeżeń — po 100 pozycji i dopisek „… i N więcej — pełna lista w logu”', () => {
    /** @type {Record<string, string>} */
    const files = {};
    for (let index = 0; index < 150; index += 1) {
      files[`notatka-${String(index).padStart(3, '0')}.md`] = '# N\n';
      files[`docs/product/sierota-${String(index).padStart(3, '0')}.md`] = '# S\n';
    }
    const { outside, blocks } = parseSummary(formatSummary(analyzeFiles(files)));
    assert.deepEqual(offTemplate(outside), []);
    assert.ok(outside.includes('#### Błędy (150)') && outside.includes('#### Ostrzeżenia (150)'));
    assert.deepEqual(
      blocks.map((block) => block.lines.length),
      [SUMMARY_LIMITS.entries, SUMMARY_LIMITS.entries],
    );
    assert.equal(SUMMARY_LIMITS.entries, 100);
    assert.equal(outside.filter((line) => line === '… i 50 więcej — pełna lista w logu').length, 2);
    assert.ok(blocks[0]?.lines[0]?.startsWith('notatka-000.md · '), 'pozycje w kolejności logu');
  });

  it('EVM-013 AC5: najgorszy przypadek (300 ścieżek ok. 4 KB ze znakami sterującymi, backtickami i polskimi znakami) — każdy blok ≤ 400 KiB z płotkami, całość < 1 MiB', () => {
    /** @type {Record<string, string>} */
    const files = {};
    const noise = '\u0001ą`ż\u202e'.repeat(800);
    for (let index = 0; index < 150; index += 1) {
      files[`.scratch/${noise}-${index}.md`] = '# R\n';
      files[`docs/product/${noise}-${index}.md`] = '# S\n';
    }
    const summary = formatSummary(analyzeFiles(files));
    assert.ok(Buffer.byteLength(summary) < MIB, `podsumowanie ma ${Buffer.byteLength(summary)} B`);
    const { outside, blocks } = parseSummary(summary);
    assert.deepEqual(offTemplate(outside), []);
    assert.equal(blocks.length, 2);
    for (const block of blocks) {
      const bytes = Buffer.byteLength(`${block.fence}text\n${block.lines.map((line) => `${line}\n`).join('')}${block.fence}\n`);
      assert.ok(bytes <= SUMMARY_LIMITS.blockBytes, `blok ma ${bytes} B`);
      assert.ok(block.lines.length > 0 && block.lines.length < 150);
    }
    assert.equal(SUMMARY_LIMITS.blockBytes, 400 * 1024);
    const omitted = outside.filter((line) => line.startsWith('… i ')).map((line) => Number(/\d+/.exec(line)?.[0]));
    assert.deepEqual(
      omitted,
      blocks.map((block) => 150 - block.lines.length),
    );
  });

  it('EVM-013 AC5: seria backticków dłuższa niż limit bloku — pozycja tylko w logu, podsumowanie < 1 MiB i z poprawną strukturą', () => {
    const summary = formatSummary(
      analyzeFiles({ [`docs/product/${'`'.repeat(500 * 1024)}.md`]: '# X\n', 'docs/product/krotka.md': '# K\n' }),
    );
    assert.ok(Buffer.byteLength(summary) < MIB);
    const { outside, blocks } = parseSummary(summary);
    assert.deepEqual(offTemplate(outside), []);
    assert.deepEqual(blocks, []);
    assert.ok(outside.includes('… i 2 więcej — pełna lista w logu'));
  });

  it('EVM-013 AC5: znacznik z treści dokumentu i z pola title nie występuje w żadnym wyjściu (check, --list, --summary, raport sprzątania)', () => {
    const MARKER = 'SYNTETYCZNY-ZNACZNIK-EVM013';
    const repo = createTempRepo({
      files: {
        ...baseFiles(),
        'docs/notes/plan.md': doc(
          { title: MARKER, lifecycle: 'milestone', milestone: 'M0', expires: '2020-01-01' },
          `# ${MARKER}\n${MARKER}\n`,
        ),
        'notatka.md': doc({ title: MARKER }, `# ${MARKER}\n`),
      },
    });
    try {
      const runs = [['check'], ['check', '--list'], ['check', '--summary'], ['check', '--list', '--summary'], ['cleanup-report', 'M0']].map(
        (argv) => runCli(argv, { cwd: repo.root, env: repo.env }),
      );
      assert.deepEqual(
        runs.map((run) => run.code),
        [1, 1, 1, 1, 0],
      );
      for (const run of runs) {
        assert.ok(run.stdout.length > 0);
        assert.ok(!run.stdout.includes(MARKER) && !run.stderr.includes(MARKER), 'znacznik w wyjściu');
      }
      const analysis = analyzeFiles({ 'docs/notes/plan.md': doc({ title: MARKER, lifecycle: 'milestone', milestone: 'M0' }, MARKER) });
      assert.ok(!formatCleanupReport(buildCleanupReport(analysis, 'M0')).includes(MARKER));
    } finally {
      repo.cleanup();
    }
  });
});

describe('check --summary — log, kody wyjścia i zapis tylko przez krok workflowu (EVM-013 AC2, AC3, AC5)', () => {
  it('EVM-013 AC2: stderr trybu --summary jest bajtowo równy stdout check (także z --list) — te same liczby w logu i w podsumowaniu', () => {
    const repo = createTempRepo({ files: { ...baseFiles(), 'notatka.md': '# N\n', 'docs/product/zapomniany.md': '# Z\n' } });
    try {
      for (const extra of [[], ['--list']]) {
        const plain = runCli(['check', ...extra], { cwd: repo.root, env: repo.env });
        const summary = runCli(['check', ...extra, '--summary'], { cwd: repo.root, env: repo.env });
        assert.equal(summary.code, plain.code);
        assert.equal(summary.stderr, plain.stdout);
        assert.ok(summary.stdout.startsWith('### Walidator dokumentacji (EVM-013)\n'));
        assert.ok(summary.stdout.includes('\nbłędy: 1 · ostrzeżenia: 1\n') && plain.stdout.includes('\nbłędy: 1 · ostrzeżenia: 1\n'));
      }
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-013 AC2: ostrzeżenie zależne od daty (expires) nie zmienia kodu wyjścia — zmienia się tylko licznik ostrzeżeń', () => {
    const repo = createTempRepo({
      files: {
        ...baseFiles(),
        'docs/README.md': '# D\n- process/workflow.md product/roadmap.md notes/plan.md\n',
        'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M0', expires: '2026-10-01' }),
      },
    });
    try {
      const before = runMain(['check', '--summary'], { cwd: repo.root, env: repo.env, now: () => new Date('2026-10-01T12:00:00Z') });
      const after = runMain(['check', '--summary'], { cwd: repo.root, env: repo.env, now: () => new Date('2026-10-05T12:00:00Z') });
      assert.deepEqual([before.code, after.code], [EXIT.ok, EXIT.ok]);
      assert.ok(before.stdout.includes('\nbłędy: 0 · ostrzeżenia: 0\n'));
      assert.ok(after.stdout.includes('\nbłędy: 0 · ostrzeżenia: 1\n'));
      assert.ok(after.stdout.includes('docs/notes/plan.md · kamień milowy · przeterminowany: expires 2026-10-01 (dzisiaj 2026-10-05)'));
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-013 AC3: kody wyjścia procesu z --summary — 0 bez błędów, 1 przy błędach, 2 bez repozytorium git (wtedy podsumowanie puste)', () => {
    const clean = createTempRepo({ files: baseFiles() });
    const broken = createTempRepo({ files: { ...baseFiles(), 'notatka.md': '# N\n' } });
    const noGit = createTempRepo({ init: false, gitignore: null });
    try {
      mkdirSync(join(noGit.root, 'docs'));
      const ok = runCli(['check', '--summary'], { cwd: clean.root, env: clean.env });
      const failed = runCli(['check', '--summary'], { cwd: broken.root, env: broken.env });
      const usage = runCli(['check', '--summary'], { cwd: join(noGit.root, 'docs'), env: noGit.env });
      assert.deepEqual([ok.code, failed.code, usage.code], [0, 1, 2]);
      assert.ok(ok.stdout.includes('\nWynik: brak błędów i ostrzeżeń — dokumentacja zgodna z polityką\n'));
      assert.ok(failed.stdout.includes('\nWynik: błędy (1) — popraw je przed oddaniem przyrostu\n'));
      assert.ok(failed.stderr.includes('\nWynik: błędy (1) — popraw je przed oddaniem przyrostu (docs/process/document-lifecycle.md)\n'));
      assert.equal(usage.stdout, '');
      assert.ok(usage.stderr.includes('brak repozytorium git'));
    } finally {
      clean.cleanup();
      broken.cleanup();
      noGit.cleanup();
    }
  });

  it('EVM-013 AC3: --summary tylko z check — z cleanup-report, z wartością i przy argumencie pozycyjnym kod 2', () => {
    const repo = createTempRepo({ files: baseFiles() });
    try {
      for (const argv of [
        ['cleanup-report', 'M0', '--summary'],
        ['check', '--summary=tak'],
        ['check', '--summary', '2026-10-02'],
      ]) {
        const result = runCli(argv, { cwd: repo.root, env: repo.env });
        assert.equal(result.code, EXIT.usage, argv.join(' '));
        assert.equal(result.stdout, '');
        assert.ok(result.stderr.startsWith('Nie można wykonać polecenia: '), argv.join(' '));
      }
      const report = runMain(['cleanup-report', 'M0', '--summary'], { cwd: repo.root, env: repo.env });
      assert.ok(report.stderr.includes('opcja --summary dotyczy tylko polecenia check'));
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-013 AC5: narzędzie nie zapisuje pliku podsumowania — proces ze wskazanym GITHUB_STEP_SUMMARY zostawia plik pusty', () => {
    const repo = createTempRepo({ files: { ...baseFiles(), 'notatka.md': '# N\n' } });
    try {
      const target = join(repo.base, 'step-summary.md');
      writeFileSync(target, '');
      for (const argv of [['check', '--summary'], ['check'], ['check', '--list', '--summary']]) {
        const result = runCli(argv, { cwd: repo.root, env: { ...repo.env, GITHUB_STEP_SUMMARY: target } });
        assert.equal(result.code, EXIT.findings);
        assert.ok(result.stdout.length > 0);
      }
      assert.equal(readFileSync(target, 'utf8'), '');
    } finally {
      repo.cleanup();
    }
  });
});
