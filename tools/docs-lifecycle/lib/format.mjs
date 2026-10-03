// @ts-check
/**
 * Output of the validator and the cleanup report (Polish, UTF-8, `/` in paths, deterministic order).
 * Only paths and metadata are printed — never document content. Every line is escaped (finding I).
 */
import { CLASS_LABELS } from './analyze.mjs';
import { ACTIONS } from './cleanup.mjs';
import { CLASSES } from './config.mjs';
import { escapeText } from './text.mjs';

const SEP = ' · ';
const SEVERITY_LABELS = /** @type {Record<string, string>} */ ({ error: 'BŁĄD', warning: 'OSTRZEŻENIE' });

export const USAGE = `Walidator cyklu życia dokumentów (EVM-012) — zasady: docs/process/document-lifecycle.md

Użycie:
  node tools/docs-lifecycle/cli.mjs check [--list] [--today YYYY-MM-DD]
  node tools/docs-lifecycle/cli.mjs cleanup-report <M#> [--today YYYY-MM-DD]
  node tools/docs-lifecycle/cli.mjs --help

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
 * @param {string[]} lines
 * @returns {string} escaped lines, each terminated with LF
 */
function render(lines) {
  return lines.map((line) => `${escapeText(line)}\n`).join('');
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
  lines.push(`błędy: ${analysis.errorCount}${SEP}ostrzeżenia: ${analysis.warningCount}`);
  if (analysis.errorCount > 0) {
    lines.push(`Wynik: błędy (${analysis.errorCount}) — popraw je przed oddaniem przyrostu (${policy})`);
  } else if (analysis.warningCount > 0) {
    lines.push(`Wynik: brak błędów; ostrzeżenia (${analysis.warningCount}) do przejrzenia — nie blokują`);
  } else {
    lines.push('Wynik: brak błędów i ostrzeżeń — dokumentacja zgodna z polityką');
  }
  return render(lines);
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
