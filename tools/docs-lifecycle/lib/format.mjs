// @ts-check
/**
 * Output of the validator and the cleanup report (Polish, UTF-8, `/` in paths, deterministic order).
 * Only paths and metadata are printed — never document content. Every line is escaped (finding I) and never a workflow
 * command of the GitHub Actions runner (EVM-013 L2, W1).
 */
import { CLASS_LABELS } from './analyze.mjs';
import { ACTIONS } from './cleanup.mjs';
import { CLASSES } from './config.mjs';
import { safeLine } from './text.mjs';

const SEP = ' · ';
const SEVERITY_LABELS = /** @type {Record<string, string>} */ ({ error: 'BŁĄD', warning: 'OSTRZEŻENIE' });

export const USAGE = `Walidator cyklu życia dokumentów (EVM-012) — zasady: docs/process/document-lifecycle.md

Użycie:
  node tools/docs-lifecycle/cli.mjs check [--list] [--today YYYY-MM-DD] [--summary]
  node tools/docs-lifecycle/cli.mjs cleanup-report <M#> [--today YYYY-MM-DD]
  node tools/docs-lifecycle/cli.mjs --help

--summary (krok CI, EVM-013): podsumowanie przebiegu GitHub Actions w Markdown na stdout, raport na stderr (log).

Skróty npm: npm run docs:check · npm run docs:cleanup -- M0 · npm run test:tools
Windows PowerShell 5.1 usuwa gołe --, więc opcje podawaj przez node tools/docs-lifecycle/cli.mjs …
albo z '--' w cudzysłowie, np. npm run docs:check '--' --list

Kody wyjścia: 0 — brak błędów (ostrzeżenia dozwolone) albo raport wygenerowany; 1 — błędy walidacji;
2 — błąd użycia lub środowiska (argumenty, brak repozytorium git, nieznany kamień milowy).
`;

/**
 * @param {string | null} cls
 * @returns {string}
 */
export function classLabel(cls) {
  return cls === null ? '—' : CLASS_LABELS[cls];
}

/**
 * The only way text leaves the tool (stdout and stderr): every line through `safeLine`.
 * @param {string[]} lines
 * @returns {string} safe lines, each terminated with LF
 */
export function render(lines) {
  return lines.map((line) => `${safeLine(line)}\n`).join('');
}

/**
 * @param {import('./analyze.mjs').Analysis} analysis
 * @param {{ list: boolean, policy: string }} options
 * @returns {string}
 */
export function formatCheck(analysis, { list, policy }) {
  /** @type {string[]} */
  const lines = [];
  if (list) {
    lines.push(`Pliki .md (${analysis.files.length}) — ścieżka · klasa · źródło klasy:`);
    for (const file of analysis.files) lines.push([file.path, classLabel(file.class), file.classSource].join(SEP));
    lines.push('');
  }
  for (const finding of analysis.findings) {
    lines.push([SEVERITY_LABELS[finding.severity], finding.path, classLabel(finding.class), finding.reason].join(SEP));
  }
  if (analysis.findings.length > 0) lines.push('');
  /** @param {string | null} cls */
  const count = (cls) => analysis.files.filter((file) => file.class === cls).length;
  lines.push(`Podsumowanie (${analysis.today}, Europe/Warsaw) — plików .md: ${analysis.files.length}`);
  for (const cls of CLASSES) lines.push(`- ${CLASS_LABELS[cls]} (${cls}): ${count(cls)}`);
  lines.push(`- bez klasy: ${count(null)}`);
  const manual = analysis.files.filter((file) => file.manual);
  lines.push(`Klasa nadana ręcznie (pole lifecycle w docs/notes/): ${manual.length === 0 ? 'brak' : manual.length}`);
  for (const file of manual) lines.push(`- ${file.path}${SEP}${classLabel(file.class)}`);
  lines.push(countsText(analysis), resultText(analysis, ` (${policy})`));
  return render(lines);
}

/**
 * @param {import('./analyze.mjs').Analysis} analysis
 * @returns {string}
 */
function countsText(analysis) {
  return `błędy: ${analysis.errorCount}${SEP}ostrzeżenia: ${analysis.warningCount}`;
}

/**
 * The result — the same three texts in the log and in the step summary.
 * @param {import('./analyze.mjs').Analysis} analysis
 * @param {string} policyReference appended to the text about errors (the step summary leaves it out)
 * @returns {string}
 */
function resultText(analysis, policyReference) {
  if (analysis.errorCount > 0) return `Wynik: błędy (${analysis.errorCount}) — popraw je przed oddaniem przyrostu${policyReference}`;
  if (analysis.warningCount > 0) return `Wynik: brak błędów; ostrzeżenia (${analysis.warningCount}) do przejrzenia — nie blokują`;
  return 'Wynik: brak błędów i ostrzeżeń — dokumentacja zgodna z polityką';
}

/** Limits of the step summary (EVM-013 AC5): entries per list and UTF-8 bytes per code block, fences included. */
export const SUMMARY_LIMITS = Object.freeze({ entries: 100, blockBytes: 400 * 1024 });

const BLOCK_INFO = 'text';

/**
 * Markdown for the GitHub Actions step summary (EVM-013 AC2, AC5; security-engineer, check 5): a fixed structure of
 * trusted texts, numbers and the day; values from the repository (path · class · reason, as in the log) only inside
 * fenced code blocks, so they never become links, images, HTML or formatting, and the policy path from the
 * configuration is left out (recommendation e). Written to stdout — the workflow step redirects it to the summary file.
 * @param {import('./analyze.mjs').Analysis} analysis
 * @returns {string}
 */
export function formatSummary(analysis) {
  /** @param {'error' | 'warning'} severity */
  const entries = (severity) =>
    analysis.findings
      .filter((finding) => finding.severity === severity)
      .map((finding) => [finding.path, classLabel(finding.class), finding.reason].join(SEP));
  return render([
    '### Walidator dokumentacji (EVM-013)',
    '',
    resultText(analysis, ''),
    '',
    countsText(analysis),
    '',
    `Dzień: ${analysis.today} (Europe/Warsaw)${SEP}plików .md: ${analysis.files.length}`,
    '',
    ...summaryList(`Błędy (${analysis.errorCount})`, entries('error')),
    ...summaryList(`Ostrzeżenia (${analysis.warningCount})`, entries('warning')),
    'Pełna lista ustaleń — w logu kroku. Powtórz sprawdzenie lokalnie: `npm run docs:check`.',
  ]);
}

/**
 * One list of the step summary: a heading, the leading entries in a fenced code block (or „brak”) and the number of
 * entries left for the log.
 * @param {string} title
 * @param {string[]} entries
 * @returns {string[]}
 */
function summaryList(title, entries) {
  const lines = [`#### ${title}`, ''];
  if (entries.length === 0) return [...lines, 'brak', ''];
  const { shown, fence } = fitBlock(entries.map(safeLine));
  if (shown.length > 0) lines.push(`${fence}${BLOCK_INFO}`, ...shown, fence, '');
  const omitted = entries.length - shown.length;
  if (omitted > 0) lines.push(`… i ${omitted} więcej — pełna lista w logu`, '');
  return lines;
}

/**
 * Entries in log order up to the first one that would break a limit: at most `SUMMARY_LIMITS.entries` and
 * `SUMMARY_LIMITS.blockBytes` for the whole block. The fence is one backtick longer than the longest run of backticks
 * inside (at least three), so no entry can close it.
 * @param {string[]} lines safe single lines
 * @returns {{ shown: string[], fence: string }}
 */
function fitBlock(lines) {
  /** @type {string[]} */
  const shown = [];
  let bytes = 0;
  let longestRun = 0;
  for (const line of lines) {
    if (shown.length === SUMMARY_LIMITS.entries) break;
    const run = Math.max(longestRun, backtickRun(line));
    const fenceLength = Math.max(3, run + 1);
    const lineBytes = Buffer.byteLength(line) + 1;
    // Opening fence with the info string and the closing fence, each with its line feed.
    if (bytes + lineBytes + 2 * (fenceLength + 1) + BLOCK_INFO.length > SUMMARY_LIMITS.blockBytes) break;
    shown.push(line);
    bytes += lineBytes;
    longestRun = run;
  }
  return { shown, fence: '`'.repeat(Math.max(3, longestRun + 1)) };
}

/**
 * @param {string} text
 * @returns {number} length of the longest run of backticks
 */
function backtickRun(text) {
  let longest = 0;
  for (const [run] of text.matchAll(/`+/g)) longest = Math.max(longest, run.length);
  return longest;
}

/**
 * Inline code for a Markdown table cell: backticks inside → double fence; `|` escaped.
 * @param {string} text
 * @returns {string}
 */
function codeCell(text) {
  const code = text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
  return tableCell(code);
}

/**
 * @param {string} text
 * @returns {string}
 */
function tableCell(text) {
  return text.replace(/\|/g, '\\|');
}

/**
 * @param {import('./cleanup.mjs').CleanupReport} report
 * @returns {string}
 */
export function formatCleanupReport(report) {
  const lines = [
    `# Raport sprzątania dokumentacji — ${report.target}`,
    '',
    `Data: ${report.today} (Europe/Warsaw) · plików .md: ${report.fileCount}`,
    '',
  ];
  if (report.errorCount > 0) {
    lines.push(
      `> **Uwaga:** walidator zgłasza błędy (${report.errorCount}) — uruchom \`npm run docs:check\` i popraw je przed decyzją; pliki z błędami nie są proponowane do usunięcia.`,
      '',
    );
  }
  if (report.items.length === 0) {
    lines.push(
      `Brak pozycji do sprzątania dla ${report.target} — żaden plik nie jest przypisany do ${report.target} ani przeterminowany lub osierocony.`,
    );
  } else {
    lines.push('| Ścieżka | Klasa | Proponowana akcja | Uzasadnienie |', '|---|---|---|---|');
    for (const item of report.items) {
      lines.push(`| ${codeCell(item.path)} | ${classLabel(item.class)} | ${item.action} | ${tableCell(item.reason)} |`);
    }
    const removals = report.items.filter((item) => item.action === ACTIONS.remove).length;
    lines.push('', `Pozycje: ${report.items.length} (usuń: ${removals}, przejrzyj: ${report.items.length - removals}).`);
  }
  lines.push('', '_Tylko odczyt — żaden plik nie został zmieniony; decyzję podejmuje Konrad w `/milestone close`._');
  return render(lines);
}
