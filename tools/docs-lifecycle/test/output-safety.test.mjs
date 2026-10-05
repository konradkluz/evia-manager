// @ts-check
/**
 * Output safety (EVM-013 AC4; security-engineer L1, L2, L4, W1–W3): file names and arguments never become workflow
 * commands of the GitHub Actions runner (V2 prefix at the start of a line, V1 prefix anywhere in a line), control characters
 * are escaped and the `git rm --cached` hint quotes the path for a POSIX shell.
 * Payloads are composed in code (helpers/runner.mjs): never in test titles or assertion messages, and line checks report
 * only `stream:line` (W2). Synthetic data only; files are created only through `fs` and git with argument arrays.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { formatCheck } from '../lib/format.mjs';
import { EXIT } from '../lib/main.mjs';
import { escapeText, safeLine, shellQuote } from '../lib/text.mjs';
import { runCli, runMain } from './helpers/cli.mjs';
import { analyzeFiles, baseFiles, doc } from './helpers/fixtures.mjs';
import { commandLines, controlLines, printable, V1, V2 } from './helpers/runner.mjs';
import { createTempRepo } from './helpers/temp-repo.mjs';

const POLICY = 'docs/process/document-lifecycle.md';

/** Names impossible in the Windows file system (`:`, line feed, invalid UTF-8) and `sh` — checked on Linux (cloud, CI). */
const POSIX_ONLY = process.platform === 'win32' ? 'nazwy plików i sh niedostępne w Windows — sprawdza Linux (chmura, CI)' : false;

/** Synthetic file names with workflow commands; V1 also in the middle of a name (W1). */
const COMMAND_NAMES = [
  `${V2}error${V2}x.md`,
  `${V1}error]x.md`,
  `${V2}notice${V2}root.md`,
  `x${V1}add-mask]y.md`,
  `x${V1}stop-commands]t.md`,
  `a\n${V2}warning title=OK${V2}Wszystko OK.md`,
];

/** Names starting with V2 — shown escaped at the start of a `--list` line. */
const V2_LEADING = COMMAND_NAMES.filter((name) => name.startsWith(V2)).length;

/** Scratch files added to git by mistake — the hint quotes their paths (L4, W3). */
const SCRATCH = ['.scratch/$(id).md', ".scratch/it's.md", ".scratch/x'$(id)'.md"];

/** W1: an orphaned note with V1 in the middle of its name — exit code 0, the name in a warning and in the manual list. */
const ORPHAN = `docs/notes/a${V1}error]Wszystko OK.md`;

const HINT_START = '(git rm --cached -- ';
const HINT_END = ') i trzymaj tylko w ';

/**
 * The `git rm --cached` command of a hint, cut from a line of real output and pasted into `sh` with `printf %s` in place
 * of `git rm --cached --`: prints the path argument exactly as the shell sees it (W3).
 * @param {string} line
 * @returns {string}
 */
function pastedPath(line) {
  const start = line.indexOf(HINT_START);
  const end = line.lastIndexOf(HINT_END);
  assert.ok(start >= 0 && end > start, 'brak wskazówki git rm --cached w wierszu');
  const command = line.slice(start + 1, end).replace(/^git rm --cached --/, 'printf %s');
  assert.ok(command.startsWith('printf %s '), 'polecenie wskazówki zaczyna się od git rm --cached --');
  return execFileSync('sh', ['-c', command], { encoding: 'utf8' });
}

/**
 * @param {{ stdout: string, stderr: string }} result
 * @returns {{ stdout: string, stderr: string }}
 */
const streams = ({ stdout, stderr }) => ({ stdout, stderr });

describe('safeLine — linia wyjścia, której runner nie weźmie za polecenie (EVM-013 AC4, W1)', () => {
  it('EVM-013 AC4: dwa dwukropki na początku linii — pierwszy znak zapisany jak escapowanie', () => {
    assert.equal(printable(safeLine(`${V2}error${V2}x.md`)), printable(`\\u{3A}:error${V2}x.md`));
    assert.equal(printable(safeLine(`${V2}${V2}`)), printable(`\\u{3A}:${V2}`));
  });

  it('EVM-013 AC4 (W1): dwa krzyżyki z nawiasem — na początku, w środku, kilka razy w linii i w serii krzyżyków', () => {
    assert.equal(printable(safeLine(`${V1}error]x.md`)), printable('\\u{23}#[error]x.md'));
    assert.equal(printable(safeLine(`a${V1}add-mask]b ${V1}stop-commands]c`)), printable('a\\u{23}#[add-mask]b \\u{23}#[stop-commands]c'));
    assert.equal(printable(safeLine(`#${V1}x]`)), printable('#\\u{23}#[x]'));
    assert.equal(printable(safeLine(`${V2}${V1}x]`)), printable('\\u{3A}:\\u{23}#[x]'));
  });

  it('EVM-013 AC4 (W1): odstępy Zs przed dwoma dwukropkami zostają, a dwukropek jest neutralizowany; inne białe znaki są escapowane', () => {
    for (const blank of [' ', '   ', '\u00a0', '\u1680', '\u2000', '\u200a', '\u202f', '\u205f', '\u3000']) {
      const label = `U+${Number(blank.codePointAt(0)).toString(16).toUpperCase()}`;
      assert.equal(printable(safeLine(`${blank}${V2}error${V2}x`)), printable(`${blank}\\u{3A}:error${V2}x`), label);
    }
    for (const [blank, escaped] of [
      ['\t', '\\u{9}'],
      ['\u000b', '\\u{B}'],
      ['\u0085', '\\u{85}'],
      ['\u2028', '\\u{2028}'],
      ['\u2029', '\\u{2029}'],
      ['\u180e', '\\u{180E}'],
      ['\ufeff', '\\u{FEFF}'],
    ]) {
      assert.equal(printable(safeLine(`${blank}${V2}error${V2}x`)), printable(`${escaped}${V2}error${V2}x`), escaped);
    }
  });

  it('EVM-013 AC4: linie bez poleceń runnera się nie zmieniają (dwukropki i krzyżyki w środku linii, pojedyncze znaki)', () => {
    for (const line of ['docs/notatka-łódź.md', `a${V2}b`, ':x', '#[x', '# #[x', '## Przegląd', '', 'BŁĄD · a.md · — · powód']) {
      assert.equal(printable(safeLine(line)), printable(line));
    }
  });

  it('EVM-013 AC4: znaki sterujące escapowane jak dotychczas — wynik to zawsze jedna linia', () => {
    const text = 'a\nb\r\u2028c\u202e';
    assert.equal(safeLine(text), escapeText(text));
    assert.ok(!safeLine(`x\n${V2}warning${V2}y`).includes('\n'), 'jedna linia');
  });

  it('EVM-013 AC4: safeLine jest idempotentne — podwójne przejście (blok podsumowania i render) nie zmienia linii', () => {
    for (const line of [...COMMAND_NAMES, ORPHAN, ...SCRATCH, `\t${V2}x`, `\u00a0${V2}x`, `${V2}${V1}x]`]) {
      assert.equal(printable(safeLine(safeLine(line))), printable(safeLine(line)));
    }
  });
});

describe('shellQuote — ścieżka we wskazówce git rm --cached (EVM-013 AC4, L4)', () => {
  it("EVM-013 AC4: cytowanie POSIX — wartość w apostrofach, apostrof jako zamknięcie, \\' i ponowne otwarcie", () => {
    assert.equal(shellQuote('.scratch/a.md'), "'.scratch/a.md'");
    assert.equal(shellQuote(".scratch/it's.md"), "'.scratch/it'\\''s.md'");
    assert.equal(shellQuote(''), "''");
  });

  it('EVM-013 AC4: wskazówka dla pliku roboczego w gicie zawiera zacytowaną ścieżkę', () => {
    const analysis = analyzeFiles({ '.scratch/$(id).md': '# R\n' });
    const finding = analysis.findings.find((item) => item.code === 'ephemeral-tracked');
    assert.ok(finding?.reason.includes("(git rm --cached -- '.scratch/$(id).md')"), String(finding?.reason));
  });
});

describe('wyjście walidatora bez poleceń runnera — nazwy plików (EVM-013 AC4; L2, W1)', () => {
  it('EVM-013 AC4: check i check --list w pamięci — nazwy z poleceniami runnera, z LF, osierocona notatka i pliki robocze', () => {
    const files = Object.fromEntries([...COMMAND_NAMES, ...SCRATCH].map((name) => [name, '# X\n']));
    const analysis = analyzeFiles({ ...files, [ORPHAN]: doc({ lifecycle: 'living' }) });
    for (const list of [false, true]) {
      const text = formatCheck(analysis, { list, policy: POLICY });
      assert.deepEqual(commandLines({ stdout: text }), []);
      assert.deepEqual(controlLines({ stdout: text }), []);
      assert.equal(text.split('\n').filter((line) => line.startsWith('BŁĄD · ')).length, COMMAND_NAMES.length + SCRATCH.length);
    }
    const listed = formatCheck(analysis, { list: true, policy: POLICY });
    assert.equal(listed.split('\n').filter((line) => line.startsWith('\\u{3A}:')).length, V2_LEADING, 'nazwy pokazane po neutralizacji');
  });

  it(
    'EVM-013 AC4: proces CLI i wywołanie w pamięci na repozytorium tymczasowym — kod 1, żadna linia stdout ani stderr nie jest poleceniem runnera, bez znaków sterujących',
    { skip: POSIX_ONLY },
    () => {
      const files = { ...baseFiles(), ...Object.fromEntries([...COMMAND_NAMES, ...SCRATCH].map((name) => [name, '# X\n'])) };
      const repo = createTempRepo({ files, tracked: SCRATCH });
      try {
        for (const argv of [['check'], ['check', '--list'], ['check', '--summary'], ['check', '--list', '--summary']]) {
          for (const result of [runCli(argv, { cwd: repo.root, env: repo.env }), runMain(argv, { cwd: repo.root, env: repo.env })]) {
            assert.equal(result.code, EXIT.findings, argv.join(' '));
            assert.deepEqual(commandLines(streams(result)), [], argv.join(' '));
            assert.deepEqual(controlLines(streams(result)), [], argv.join(' '));
            // With --summary the report goes to stderr (the log) and the summary to stdout.
            const summary = argv.includes('--summary');
            if (!summary) assert.equal(result.stderr.length, 0, 'stderr pusty');
            const errors = (summary ? result.stderr : result.stdout).split('\n').filter((line) => line.startsWith('BŁĄD · '));
            assert.equal(errors.length, COMMAND_NAMES.length + SCRATCH.length, argv.join(' '));
          }
        }
      } finally {
        repo.cleanup();
      }
    },
  );

  it('EVM-013 AC4 (W1): osierocona notatka z dwoma krzyżykami i nawiasem w środku nazwy — kod 0, ostrzeżenie i lista „Klasa nadana ręcznie” bez polecenia runnera', () => {
    const repo = createTempRepo({ files: { ...baseFiles(), [ORPHAN]: doc({ lifecycle: 'living' }) } });
    try {
      for (const argv of [['check'], ['check', '--list'], ['check', '--summary']]) {
        for (const result of [runCli(argv, { cwd: repo.root, env: repo.env }), runMain(argv, { cwd: repo.root, env: repo.env })]) {
          assert.equal(result.code, EXIT.ok, argv.join(' '));
          assert.deepEqual(commandLines(streams(result)), [], argv.join(' '));
          const lines = (argv.includes('--summary') ? result.stderr : result.stdout).split('\n');
          assert.ok(
            lines.some((line) => line.startsWith(`OSTRZEŻENIE · ${safeLine(ORPHAN)} · żywy · osierocony: `)),
            'ostrzeżenie „osierocony” z nazwą po neutralizacji',
          );
          assert.ok(lines.includes(`- ${safeLine(ORPHAN)} · żywy`), 'lista „Klasa nadana ręcznie” z nazwą po neutralizacji');
        }
      }
    } finally {
      repo.cleanup();
    }
  });
});

describe('stderr bez poleceń runnera — błędy użycia, środowiska i nieoczekiwane (EVM-013 AC4; L1, W1)', () => {
  it('EVM-013 AC4 (L1): argumenty z LF i poleceniami runnera — kod 2, komunikat w jednej linii i pomoc, stdout pusty', () => {
    const repo = createTempRepo({ files: baseFiles() });
    try {
      for (const argv of [
        ['check', `x\n${V2}warning${V2}y`],
        ['check', `${V1}error]y`],
        [`${V2}error${V2}x\n${V1}error]y`],
        ['check', '--today', `2026\n${V2}warning${V2}x`],
        ['cleanup-report', `M0\n${V2}notice${V2}x ${V1}add-mask]y`],
      ]) {
        const result = runMain(argv, { cwd: repo.root, env: repo.env });
        assert.equal(result.code, EXIT.usage);
        assert.equal(result.stdout.length, 0, 'stdout pusty');
        assert.ok(result.stderr.startsWith('Nie można wykonać polecenia: '), 'komunikat błędu użycia');
        assert.equal(result.stderr.split('\n').length, 3, 'komunikat w jednej linii i linia pomocy');
        assert.deepEqual(commandLines(streams(result)), []);
        assert.deepEqual(controlLines(streams(result)), []);
      }
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-013 AC4 (L1): nieoczekiwany błąd z LF i poleceniami runnera w komunikacie — kod 2, każda linia stosu osobno i zneutralizowana', () => {
    const repo = createTempRepo({ files: baseFiles() });
    try {
      const result = runMain(['check'], {
        cwd: repo.root,
        env: repo.env,
        now: () => {
          throw new TypeError(`zegar\n${V2}error${V2}x ${V1}error]y\r\n${V2}notice${V2}z`);
        },
      });
      assert.equal(result.code, EXIT.usage);
      assert.ok(result.stderr.startsWith('Nieoczekiwany błąd narzędzia: TypeError: zegar\n'), 'pierwsza linia z typem błędu');
      assert.ok(result.stderr.split('\n').length > 4, 'stos zostaje czytelny — linia po linii');
      assert.deepEqual(commandLines(streams(result)), []);
      assert.deepEqual(controlLines(streams(result)), []);
    } finally {
      repo.cleanup();
    }
  });

  it(
    'EVM-013 AC4 (L1): plik o nazwie w niepoprawnym UTF-8 z LF i poleceniami runnera — kod 2, stderr zneutralizowany (proces i w pamięci)',
    { skip: POSIX_ONLY },
    () => {
      const repo = createTempRepo({ files: baseFiles() });
      try {
        const name = Buffer.concat([Buffer.from([0xff]), Buffer.from(`\n${V2}warning title=OK${V2}a${V1}error]b.md`)]);
        writeFileSync(Buffer.concat([Buffer.from(`${repo.root}/`), name]), '# X\n');
        for (const result of [
          runCli(['check'], { cwd: repo.root, env: repo.env }),
          runCli(['check', '--list'], { cwd: repo.root, env: repo.env }),
          runMain(['check'], { cwd: repo.root, env: repo.env }),
        ]) {
          assert.equal(result.code, EXIT.usage);
          assert.equal(result.stdout.length, 0, 'stdout pusty');
          assert.ok(result.stderr.startsWith('Nie można wykonać polecenia: nie można odczytać pliku '), 'komunikat o pliku');
          assert.deepEqual(commandLines(streams(result)), []);
          assert.deepEqual(controlLines(streams(result)), []);
        }
      } finally {
        repo.cleanup();
      }
    },
  );
});

describe('wskazówka git rm --cached wklejona do powłoki (EVM-013 AC4; L4, W3)', () => {
  it(
    'EVM-013 AC4 (W3): polecenie wycięte z wiersza BŁĄD wyjścia check i z bloku --summary, uruchomione w sh, zwraca dosłowną ścieżkę — nic z nazwy pliku się nie wykonuje',
    { skip: POSIX_ONLY },
    () => {
      const repo = createTempRepo({
        files: { ...baseFiles(), ...Object.fromEntries(SCRATCH.map((path) => [path, '# Robocza\n'])) },
        tracked: SCRATCH,
      });
      try {
        const result = runCli(['check'], { cwd: repo.root, env: repo.env });
        const summary = runCli(['check', '--summary'], { cwd: repo.root, env: repo.env });
        assert.deepEqual([result.code, summary.code], [EXIT.findings, EXIT.findings]);
        for (const path of SCRATCH) {
          // In the step summary the same entry is a line of the code block, without the BŁĄD label.
          /** @type {Array<[string, string | undefined]>} */
          const sources = [
            ['check', result.stdout.split('\n').find((text) => text.startsWith(`BŁĄD · ${path} · roboczy · `))],
            ['--summary', summary.stdout.split('\n').find((text) => text.startsWith(`${path} · roboczy · `))],
          ];
          for (const [where, line] of sources) {
            assert.ok(line, `brak wskazówki dla ${path} (${where})`);
            const pasted = pastedPath(line);
            assert.equal(pasted, path, where);
            assert.ok(!pasted.includes('uid='), `${path} (${where})`);
          }
        }
      } finally {
        repo.cleanup();
      }
    },
  );
});
