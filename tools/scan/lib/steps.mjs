// @ts-check
/**
 * Scan steps of `pnpm run scan` and of the CI jobs (EVM-006 p. 8, SR-SUPPLY-07, SR-SUPPLY-10). Every step runs a
 * compose service, keeps its report in .scratch/scans/ and decides the gate from the report (reports.mjs).
 * Container paths: /src — read-only sources (only what the step scans), /out — .scratch/scans (output and self-test
 * fixtures), /repo/.git — the git database for gitleaks, /work — the Linux dependencies from backend-install.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateOsv } from './osv.mjs';
import {
  actionlintVerdict,
  gitleaksVerdict,
  osvVerdict,
  semgrepVerdict,
  trivyConfigVerdict,
  trivyLicenseVerdict,
  zizmorVerdict,
} from './reports.mjs';

/** @typedef {import('./reports.mjs').Verdict} Verdict */
/** @typedef {import('./compose.mjs').RunResult} RunResult */

/**
 * @typedef {object} Step
 * @property {string} id
 * @property {string} label
 * @property {string} service compose service
 * @property {string[]} args
 * @property {(root: string) => string[]} [targets] scan targets resolved on the host; none = empty target (red)
 * @property {number[]} okExit exit codes meaning "the tool worked" (findings are judged from the report)
 * @property {string | null} report report file name in .scratch/scans, `stdout` for JSON on stdout, null for none
 * @property {(report: unknown, run: RunResult) => Verdict} verdict
 */

const GITLEAKS_CONFIG = ['--config', '/config/gitleaks.toml', '--gitleaks-ignore-path', '/config/gitleaksignore'];
/** Every gitleaks call redacts secrets (A3) — also in hooks (hooks.mjs). */
export const GITLEAKS_COMMON = ['--redact', '--no-banner', ...GITLEAKS_CONFIG];

const SEMGREP_COMMON = ['scan', '--metrics=off', '--disable-version-check', '--semgrepignore-v2', '--project-root', '/src'];
const SEMGREP_RULES = [
  'p/typescript',
  'p/javascript',
  'p/nodejs',
  'p/react',
  'p/github-actions',
  'p/dockerfile',
  '/src/.semgrep/rules',
].flatMap((config) => ['--config', config]);
const TRIVY_OFFLINE = ['--config', '/src/trivy.yaml', '--format', 'json', '--exit-code', '0'];
const TRIVY_LICENSE = [
  'fs',
  ...TRIVY_OFFLINE,
  '--scanners',
  'license',
  '--pkg-types',
  'library',
  '--skip-db-update',
  '--skip-java-db-update',
  '--offline-scan',
];
const ZIZMOR_COMMON = ['--offline', '--min-severity', 'low', '--format', 'json', '--no-exit-codes'];

/**
 * Workflow files of the repository (actionlint finds no project without .git, so files are passed explicitly).
 * @param {string} root
 */
export const workflows = (root) =>
  existsSync(join(root, '.github', 'workflows'))
    ? readdirSync(join(root, '.github', 'workflows'))
        .filter((file) => /\.ya?ml$/.test(file))
        .sort()
    : [];

/** @param {RunResult} run @returns {Verdict} */
const exitVerdict = (run) => ({
  passed: run.status === 0,
  summary: run.status === 0 ? 'poprawna' : `błędy (kod ${String(run.status)})`,
  problems: run.status === 0 ? [] : lastLines(`${run.stdout}\n${run.stderr}`),
});

/** @param {string} output */
export const lastLines = (output) =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8);

/** @type {Step[]} */
export const SECURITY_STEPS = [
  {
    id: 'gitleaks',
    label: 'gitleaks — sekrety, pełna historia git (bramka 1)',
    service: 'scan-gitleaks',
    args: ['git', ...GITLEAKS_COMMON, '--report-format', 'json', '--report-path', '/out/gitleaks.json', '--exit-code', '0', '/repo'],
    okExit: [0],
    report: 'gitleaks.json',
    verdict: (report, run) => gitleaksVerdict(report, { log: run.stderr + run.stdout, requireCommits: true }),
  },
  {
    id: 'semgrep',
    label: 'Semgrep CE — SAST (bramka 2)',
    service: 'scan-semgrep',
    args: [...SEMGREP_COMMON, ...SEMGREP_RULES, '--json', '--output', '/out/semgrep.json', 'packages', 'tools', 'infra', '.github'],
    okExit: [0],
    report: 'semgrep.json',
    verdict: (report) => semgrepVerdict(report),
  },
  {
    id: 'semgrep-rules',
    label: 'Semgrep — testy reguł własnych (.semgrep/)',
    service: 'scan-semgrep',
    args: ['scan', '--test', '--metrics=off', '--disable-version-check', '/src/.semgrep/rules'],
    okExit: [0, 1],
    report: null,
    verdict: (_report, run) => exitVerdict(run),
  },
  {
    id: 'osv',
    label: 'OSV-Scanner — podatności zależności (bramka 3)',
    service: 'scan-osv',
    args: [
      'scan',
      'source',
      '--lockfile',
      'pnpm-lock.yaml:/src/pnpm-lock.yaml',
      '--config',
      '/src/osv-scanner.toml',
      '--all-packages',
      '--format',
      'json',
      '--output-file',
      '/out/osv.json',
    ],
    okExit: [0, 1],
    report: 'osv.json',
    verdict: (report) => osvVerdict(report),
  },
  {
    id: 'trivy-config',
    label: 'Trivy — konfiguracja (Dockerfile, bramka 5)',
    service: 'scan-trivy',
    args: ['config', ...TRIVY_OFFLINE, '--skip-check-update', '--output', '/out/trivy-config.json', '/src/infra'],
    okExit: [0],
    report: 'trivy-config.json',
    verdict: (report) => trivyConfigVerdict(report),
  },
  {
    id: 'zizmor',
    label: 'zizmor — workflowy GitHub Actions (bramka 5a)',
    service: 'scan-zizmor',
    args: [...ZIZMOR_COMMON, '--config', '/src/zizmor.yml'],
    targets: (root) => workflows(root).map((file) => `/src/.github/workflows/${file}`),
    okExit: [0],
    report: 'stdout',
    verdict: (report) => zizmorVerdict(report),
  },
  {
    id: 'actionlint',
    label: 'actionlint — składnia workflowów',
    service: 'scan-actionlint',
    args: ['-format', '{{json .}}'],
    targets: (root) => workflows(root).map((file) => `.github/workflows/${file}`),
    okExit: [0, 1],
    report: 'stdout',
    verdict: (report) => actionlintVerdict(report),
  },
  {
    id: 'renovate-config',
    label: 'renovate-config-validator --strict (bramka 12)',
    service: 'renovate-validate',
    args: ['--strict', 'renovate.json'],
    okExit: [0, 1],
    report: null,
    verdict: (_report, run) => exitVerdict(run),
  },
];

/** @type {Step[]} */
export const LICENSE_STEPS = [
  {
    id: 'licenses',
    label: 'Trivy — licencje zależności produkcyjnych (bramka 4)',
    service: 'scan-trivy',
    args: [...TRIVY_LICENSE, '--output', '/out/trivy-license.json', '/work/repo'],
    okExit: [0],
    report: 'trivy-license.json',
    verdict: (report) => trivyLicenseVerdict(report),
  },
];

/**
 * A self-test passes when the gate is red and the expected identifier is present in the report.
 * @param {Verdict} gate
 * @param {boolean} found
 * @param {string} expected
 * @returns {Verdict}
 */
const selftestVerdict = (gate, found, expected) => {
  const passed = !gate.passed && found;
  const reason = gate.passed ? 'bramka zielona na celowo podatnej fiksturze' : `brak oczekiwanego identyfikatora ${expected}`;
  return { passed, summary: passed ? `czerwona bramka z ${expected} (oczekiwane)` : 'BRAMKA WYŁĄCZONA', problems: passed ? [] : [reason] };
};

/** @param {unknown} report @param {string} key @returns {string[]} */
const values = (report, key) =>
  (Array.isArray(report) ? /** @type {unknown[]} */ (report) : []).map((item) => {
    const value = typeof item === 'object' && item !== null ? /** @type {Record<string, unknown>} */ (item)[key] : undefined;
    return typeof value === 'string' ? value : '';
  });

/** @type {Step[]} */
export const SELFTEST_STEPS = [
  {
    id: 'selftest-gitleaks',
    label: 'samotest gitleaks (syntetyczny sekret)',
    service: 'scan-gitleaks',
    args: [
      'dir',
      ...GITLEAKS_COMMON,
      '--report-format',
      'json',
      '--report-path',
      '/out/selftest/gitleaks.json',
      '--exit-code',
      '0',
      '/out/selftest/gitleaks',
    ],
    okExit: [0],
    report: 'selftest/gitleaks.json',
    verdict: (report) => selftestVerdict(gitleaksVerdict(report), values(report, 'RuleID').includes('github-pat'), 'github-pat'),
  },
  {
    id: 'selftest-osv',
    label: 'samotest OSV-Scanner (podatność High z poprawką)',
    service: 'scan-osv',
    args: [
      'scan',
      'source',
      '--lockfile',
      'pnpm-lock.yaml:/out/selftest/osv/pnpm-lock.yaml',
      '--all-packages',
      '--format',
      'json',
      '--output-file',
      '/out/selftest/osv.json',
    ],
    okExit: [0, 1],
    report: 'selftest/osv.json',
    verdict: (report) =>
      selftestVerdict(
        osvVerdict(report),
        evaluateOsv(report).findings.some((finding) => finding.blocking && finding.ids.includes('GHSA-35jh-r3h4-6jhm')),
        'GHSA-35jh-r3h4-6jhm',
      ),
  },
  {
    id: 'selftest-trivy-config',
    label: 'samotest Trivy config (Dockerfile bez USER)',
    service: 'scan-trivy',
    args: ['config', ...TRIVY_OFFLINE, '--skip-check-update', '--output', '/out/selftest/trivy-config.json', '/out/selftest/trivy-config'],
    okExit: [0],
    report: 'selftest/trivy-config.json',
    verdict: (report) => selftestVerdict(trivyConfigVerdict(report), JSON.stringify(report).includes('"DS-0002"'), 'DS-0002'),
  },
  {
    id: 'selftest-licenses',
    label: 'samotest Trivy license (zależność GPL-3.0)',
    service: 'scan-trivy',
    args: [...TRIVY_LICENSE, '--output', '/out/selftest/trivy-license.json', '/out/selftest/license'],
    okExit: [0],
    report: 'selftest/trivy-license.json',
    verdict: (report) => {
      const gate = trivyLicenseVerdict(report);
      return selftestVerdict(
        gate,
        gate.problems.some((problem) => problem.startsWith('GPL-3.0')),
        'GPL-3.0',
      );
    },
  },
  {
    id: 'selftest-zizmor',
    label: 'samotest zizmor (pull_request_target + wstrzyknięcie)',
    service: 'scan-zizmor',
    args: [...ZIZMOR_COMMON, '--no-config', '/out/selftest/zizmor/.github/workflows'],
    okExit: [0],
    report: 'stdout',
    verdict: (report) => {
      const idents = values(report, 'ident');
      return selftestVerdict(
        zizmorVerdict(report),
        idents.includes('dangerous-triggers') && idents.includes('template-injection'),
        'dangerous-triggers + template-injection',
      );
    },
  },
];
