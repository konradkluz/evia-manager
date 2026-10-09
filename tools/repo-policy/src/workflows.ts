/**
 * GitHub Actions rules (ADR-0012, ADR-0016; SR-SUPPLY-04; security-engineer A2, A6, A7; architect W6) and the single
 * way to start Docker from scripts (A6, RR-03).
 */
import { list, record, text } from './files.ts';

const FORBIDDEN_TRIGGERS = ['pull_request_target', 'workflow_run', 'issue_comment'];
const USES = /^\s*-?\s*uses:\s*(\S+)(.*)$/;

/** Generic rules for every workflow file. */
export function workflowProblems(file: string, raw: string, document: unknown): string[] {
  const problems: string[] = [];
  const workflow = record(document);
  const triggers = workflow['on'];
  const triggerNames =
    typeof triggers === 'string' ? [triggers] : Array.isArray(triggers) ? triggers.map(String) : Object.keys(record(triggers));
  for (const trigger of FORBIDDEN_TRIGGERS) if (triggerNames.includes(trigger)) problems.push(`${file}: zabroniony wyzwalacz ${trigger}`);
  const permissions = record(workflow['permissions']);
  if (Object.keys(permissions).join(',') !== 'contents' || permissions['contents'] !== 'read')
    problems.push(`${file}: permissions na poziomie pliku = { contents: read }`);
  if (/\b(write-all|read-all)\b/.test(raw)) problems.push(`${file}: zabronione write-all / read-all`);
  if (/secrets:\s*inherit/.test(raw)) problems.push(`${file}: zabronione secrets: inherit`);
  if (raw.includes('secrets.') && !file.endsWith('renovate.yml')) problems.push(`${file}: sekrety (secrets.) wyłącznie w renovate.yml`);
  for (const [line, index] of raw.split('\n').map((value, position) => [value, position + 1] as const)) {
    const match = USES.exec(line);
    if (!match) continue;
    const target = match[1] ?? '';
    const comment = match[2] ?? '';
    if (target.startsWith('docker://')) {
      if (!/@sha256:[0-9a-f]{64}$/.test(target)) problems.push(`${file}:${index}: obraz docker:// bez digestu`);
    } else if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(target) || !/#\s*v\d+(\.\d+){0,2}\s*$/.test(comment)) {
      problems.push(`${file}:${index}: uses musi wskazywać pełne SHA (40 znaków) z komentarzem wersji (# vX.Y.Z)`);
    }
  }
  for (const [name, value] of Object.entries(record(workflow['jobs']))) {
    const job = record(value);
    const where = `${file}: job ${name}`;
    if (!('permissions' in job)) problems.push(`${where}: brak jawnych permissions`);
    if (typeof job['timeout-minutes'] !== 'number') problems.push(`${where}: brak timeout-minutes`);
    const runsOn = JSON.stringify(job['runs-on'] ?? '');
    if (runsOn.includes('self-hosted')) problems.push(`${where}: runnery self-hosted są zabronione`);
    for (const step of list(job['steps']).map(record)) {
      if (text(step['uses']).startsWith('actions/checkout@') && record(step['with'])['persist-credentials'] !== false) {
        problems.push(`${where}: actions/checkout bez persist-credentials: false`);
      }
    }
  }
  return problems;
}

/**
 * A2, W6: `ci-gate` depends on every other job of ci.yml, always runs and requires `success` of each dependency, with
 * the exact list of dependencies in its check (a skipped, cancelled, failed or missing job = red). K6 is not a job of
 * ci.yml — it has its own workflow (main-integrity.yml) without a concurrency group.
 */
export function ciGateProblems(document: unknown): string[] {
  const jobs = record(record(document)['jobs']);
  const gate = record(jobs['ci-gate']);
  const needs = list(gate['needs']).map(String).sort();
  const expected = Object.keys(jobs)
    .filter((name) => name !== 'ci-gate')
    .sort();
  const problems: string[] = [];
  if (JSON.stringify(needs) !== JSON.stringify(expected)) problems.push(`ci-gate: needs musi obejmować ${expected.join(', ')}`);
  if (text(gate['if']) !== 'always()') problems.push('ci-gate: wymagane if: always()');
  const script = list(gate['steps'])
    .map((step) => text(record(step)['run']))
    .join('\n');
  const keys =
    /keys == \[([^\]]*)\]/
      .exec(script)?.[1]
      ?.split(',')
      .map((key) => key.trim().replace(/"/g, '')) ?? [];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) problems.push('ci-gate: skrypt musi sprawdzać dokładną listę jobów z needs');
  if (!script.includes('all(.[]; .result == "success")')) problems.push('ci-gate: każdy job z needs musi mieć wynik success');
  if ('main-integrity' in jobs) problems.push('ci.yml: main-integrity (K6) wyłącznie w osobnym workflowie main-integrity.yml');
  return problems;
}

/**
 * The script of the documentation validator step in the quality job (EVM-013, bramka 11 — SR-SUPPLY-11): the same command
 * as `npm run docs:check` with the step summary on stdout, no pipe, the validator's exit code as the step's result
 * (0 green; 1 and 2 red; an unset summary file or a signal also red).
 */
export const DOCS_CHECK_SCRIPT =
  'status=0\nnode tools/docs-lifecycle/cli.mjs check --summary >> "$GITHUB_STEP_SUMMARY" || status=$?\nexit "$status"\n';

const VALIDATOR = 'tools/docs-lifecycle/cli.mjs';
const QUALITY = 'ci.yml: quality';
/** Actions allowed before the validator: they set up the runner and run no code of the project's dependencies. */
const SETUP_ACTIONS = ['actions/checkout@', 'pnpm/action-setup@', 'actions/setup-node@'];
const STEP_KEYS = ['name', 'shell', 'timeout-minutes', 'run'];
/** Variables of the workflow and of the quality job — never NODE_OPTIONS or GIT_*, which reach node and git. */
const ALLOWED_ENV = ['TURBO_TELEMETRY_DISABLED', 'DO_NOT_TRACK'];
/** The validator exactly as `npm run docs:check`, optionally with the summary format, followed by an operator or the end. */
const DOCS_CHECK_INVOCATION = /(?:^|\s)node tools\/docs-lifecycle\/cli\.mjs check(?: --summary)?\s*(?:>>|>|\|\||\||&&|;|$)/gm;
const FAIL_OPEN = /\|\|\s*(?:true|:)(?=\s|;|$)|\bset\s+\+e\b|\bset\s+\+o\s+errexit\b/m;
const PIPE = /(?:^|[^|])\|(?!\|)/m;

const envProblems = (where: string, env: unknown): string[] =>
  Object.keys(record(env))
    .filter((key) => !ALLOWED_ENV.includes(key))
    .map((key) => `${where}: ${key} spoza listy dozwolonej (${ALLOWED_ENV.join(', ')})`);

/** The quality job (security-engineer recommendations a–c): permissions, job-level fail-open, defaults, env, checkout. */
function qualityJobProblems(quality: Record<string, unknown>, steps: Array<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  if (JSON.stringify(quality['permissions']) !== JSON.stringify({ contents: 'read' }))
    problems.push(`${QUALITY}: permissions = { contents: read }`);
  if ('continue-on-error' in quality)
    problems.push(`${QUALITY}: zabronione continue-on-error joba (needs.quality.result byłby success, a ci-gate zielony)`);
  if ('defaults' in quality) problems.push(`${QUALITY}: zabronione defaults (shell i katalog roboczy kroków)`);
  problems.push(...envProblems(`${QUALITY}: env joba`, quality['env']));
  for (const step of steps.filter((item) => text(item['uses']).startsWith('actions/checkout@'))) {
    if (JSON.stringify(step['with']) !== JSON.stringify({ 'persist-credentials': false }))
      problems.push(`${QUALITY}: actions/checkout wyłącznie z with { persist-credentials: false } (walidator sprawdza drzewo commita)`);
  }
  return problems;
}

/** Steps before the validator: setup actions only, setup-node among them, no dependency installation. */
function setupProblems(before: Array<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  if (before.some((step) => 'run' in step))
    problems.push(`${QUALITY}: walidator dokumentacji musi być pierwszym krokiem z poleceniem (run)`);
  if (before.some((step) => !('run' in step) && !SETUP_ACTIONS.some((action) => text(step['uses']).startsWith(action))))
    problems.push(`${QUALITY}: przed walidatorem dokumentacji wyłącznie actions/checkout, pnpm/action-setup i actions/setup-node`);
  if (!before.some((step) => text(step['uses']).startsWith('actions/setup-node@')))
    problems.push(`${QUALITY}: walidator dokumentacji po actions/setup-node`);
  if (before.some((step) => text(step['uses']).startsWith('pnpm/action-setup@') && 'run_install' in record(step['with'])))
    problems.push(`${QUALITY}: pnpm/action-setup przed walidatorem bez run_install (instalacja zależności przed bramką)`);
  return problems;
}

/** The step itself: keys, shell, timeout, name and the script (fail-closed, exact command, summary, no expressions). */
function docsStepProblems(step: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const run = text(step['run']);
  if ('if' in step) problems.push(`${QUALITY}: krok walidatora dokumentacji bez if`);
  if ('continue-on-error' in step) problems.push(`${QUALITY}: krok walidatora dokumentacji bez continue-on-error`);
  if ('env' in step) problems.push(`${QUALITY}: krok walidatora dokumentacji bez env`);
  const other = Object.keys(step).filter((key) => !STEP_KEYS.includes(key) && !['if', 'continue-on-error', 'env'].includes(key));
  if (other.length > 0)
    problems.push(`${QUALITY}: krok walidatora dokumentacji — klucz spoza listy (${STEP_KEYS.join(', ')}): ${other.join(', ')}`);
  if (step['shell'] !== 'bash') problems.push(`${QUALITY}: krok walidatora dokumentacji wymaga shell: bash (-eo pipefail)`);
  if (PIPE.test(run) && step['shell'] !== 'bash')
    problems.push(`${QUALITY}: potok bez shell: bash gubi kod wyjścia walidatora dokumentacji`);
  const timeout = step['timeout-minutes'];
  if (typeof timeout !== 'number' || timeout > 5) problems.push(`${QUALITY}: krok walidatora dokumentacji wymaga timeout-minutes ≤ 5`);
  if (!text(step['name']).includes('docs:check')) problems.push(`${QUALITY}: nazwa kroku walidatora dokumentacji musi zawierać docs:check`);
  const invocations = run.split(VALIDATOR).length - 1;
  if ((run.match(DOCS_CHECK_INVOCATION) ?? []).length !== invocations)
    problems.push(
      `${QUALITY}: walidator dokumentacji wyłącznie node tools/docs-lifecycle/cli.mjs check (jedyna dodatkowa opcja: --summary)`,
    );
  if (run.includes('--today')) problems.push(`${QUALITY}: walidator dokumentacji bez --today (wynik CI nie zależy od podanej daty)`);
  if (run.includes('--list')) problems.push(`${QUALITY}: walidator dokumentacji bez --list`);
  if (FAIL_OPEN.test(run)) problems.push(`${QUALITY}: krok walidatora dokumentacji bez || true, || :, set +e i set +o errexit`);
  const lines = run.split('\n').filter((line) => line.trim() !== '');
  if (!run.includes('|| status=$?') || lines.at(-1)?.trim() !== 'exit "$status"')
    problems.push(`${QUALITY}: kod wyjścia walidatora dokumentacji musi być przekazany (|| status=$? i na końcu exit "$status")`);
  if (!run.includes('check --summary') || !run.includes('>> "$GITHUB_STEP_SUMMARY"'))
    problems.push(`${QUALITY}: podsumowanie walidatora dokumentacji do $GITHUB_STEP_SUMMARY (check --summary >> "$GITHUB_STEP_SUMMARY")`);
  if (run.includes('${{')) problems.push(`${QUALITY}: bez wyrażeń \${{ }} w run kroku walidatora dokumentacji`);
  if (run !== DOCS_CHECK_SCRIPT) problems.push(`${QUALITY}: skrypt kroku walidatora dokumentacji różny od DOCS_CHECK_SCRIPT`);
  return problems;
}

/**
 * EVM-013 AC1, AC3 (SR-SUPPLY-11; security-engineer controls 1–3, recommendations a–c): the documentation validator is the
 * first step with a command of the quality job — after setting up Node, before `pnpm install` and any code of the project's
 * dependencies — runs exactly like `npm run docs:check`, passes its exit code and writes the step summary; the quality job
 * cannot turn its failure into success and stays in ci-gate. Every weakening is reported with its own message.
 */
export function docsCheckStepProblems(document: unknown): string[] {
  const workflow = record(document);
  const jobs = record(workflow['jobs']);
  const problems: string[] = [];
  if ('defaults' in workflow) problems.push('ci.yml: zabronione defaults (shell i katalog roboczy kroków)');
  problems.push(...envProblems('ci.yml: env workflowu', workflow['env']));
  if (!list(record(jobs['ci-gate'])['needs']).includes('quality')) problems.push('ci.yml: ci-gate: needs musi zawierać quality');
  if (!('quality' in jobs)) return [...problems, 'ci.yml: brak joba quality'];
  const quality = record(jobs['quality']);
  const steps = list(quality['steps']).map(record);
  problems.push(...qualityJobProblems(quality, steps));
  const index = steps.findIndex((step) => text(step['run']).includes(VALIDATOR));
  const step = steps[index];
  if (step === undefined) return [...problems, `${QUALITY}: brak kroku walidatora dokumentacji (node tools/docs-lifecycle/cli.mjs check)`];
  return [...problems, ...setupProblems(steps.slice(0, index)), ...docsStepProblems(step)];
}

/** A7: the Renovate token is visible to the Renovate step only. */
export function renovateWorkflowProblems(raw: string, document: unknown): string[] {
  const problems: string[] = [];
  const jobs = Object.values(record(record(document)['jobs'])).map(record);
  const steps = jobs.flatMap((job) => list(job['steps']).map(record));
  const renovate = steps.filter((step) => text(step['uses']).startsWith('renovatebot/github-action@'));
  if (renovate.length !== 1) problems.push('renovate.yml: dokładnie jeden krok renovatebot/github-action');
  const step = renovate[0] ?? {};
  if (!/@sha256:[0-9a-f]{64}$/.test(text(record(step['with'])['renovate-image'])))
    problems.push('renovate.yml: obraz Renovate z digestem (renovate-image)');
  const env = record(step['env']);
  if (text(env['RENOVATE_TOKEN']) !== '${{ secrets.RENOVATE_TOKEN }}') problems.push('renovate.yml: RENOVATE_TOKEN w env kroku Renovate');
  if (env['RENOVATE_ALLOW_SCRIPTS'] !== 'false') problems.push('renovate.yml: RENOVATE_ALLOW_SCRIPTS: false');
  if ((raw.match(/secrets\./g) ?? []).length !== 1) problems.push('renovate.yml: sekret użyty wyłącznie raz — w env kroku Renovate');
  for (const job of jobs)
    if (!text(job['if']).includes("github.ref == 'refs/heads/main'")) problems.push('renovate.yml: job tylko na main');
  return problems;
}

/**
 * A6: Docker only as `docker compose -f compose.yaml run --rm <service from compose.yaml>` — never `docker run`,
 * `exec` or `cp`, never another compose file.
 */
export function dockerCommandProblems(where: string, command: string, services: readonly string[]): string[] {
  const problems: string[] = [];
  const pattern = /\bdocker(?:\.exe)?\s+(\S+)(?:\s+(\S+))?(?:\s+(\S+))?(?:\s+(\S+))?(?:\s+(\S+))?(?:\s+(\S+))?/g;
  for (const match of command.matchAll(pattern)) {
    const [, verb, flag, file, run, rm, service] = match;
    const allowed =
      verb === 'compose' && flag === '-f' && file === 'compose.yaml' && run === 'run' && rm === '--rm' && services.includes(service ?? '');
    if (!allowed)
      problems.push(`${where}: Docker wyłącznie jako docker compose -f compose.yaml run --rm <usługa> (znaleziono: ${match[0]})`);
  }
  return problems;
}

/** `ask` rules of .claude/settings.json: the owner confirms every edit of the settings and of compose files (D4a, RR-03). */
export const REQUIRED_ASK = Object.freeze(
  ['.claude/settings.json', '**/compose*.yaml', '**/compose*.yml', '**/docker-compose*.yaml', '**/docker-compose*.yml'].flatMap((path) => [
    `Edit(${path})`,
    `Write(${path})`,
  ]),
);

/**
 * EVM-077 (security-engineer M6; SR-SUPPLY-09, TM-60, TM-61): the commands that delete the development database ask the owner
 * first — `pnpm run dev:reset` (which itself needs a terminal and a typed phrase), the CLI behind it and `down -v` of
 * compose.dev.yaml. No `allow` rule may mention compose.dev.yaml or the dev commands.
 */
export const REQUIRED_ASK_COMMANDS = Object.freeze(
  [
    'pnpm run dev:reset:*',
    'pnpm dev:reset:*',
    'node tools/dev-env/cli.mjs reset:*',
    'docker compose -f compose.dev.yaml down -v:*',
  ].flatMap((command) => [`Bash(${command})`, `PowerShell(${command})`]),
);

/**
 * `deny` rules against printing the token of the orchestrator's `gh` (K4, RR-02; Konrad 2026-10-04): `gh auth token`,
 * `gh auth status --show-token` / `-t` and the credential helper `gh auth git-credential` (prints `password=<token>`) run as
 * `gh`, `gh.exe` or a full path (quoted or escaped) in the Bash tool (Git Bash) and in the PowerShell tool. `*` matches any text at any position, so `*gh*` covers every executable form and `-t` also
 * covers `--show-token`. A command that only quotes these words (grep, echo, a commit message or PR body) is denied too —
 * use the Grep tool and message files. A hindrance against accidental output, not a boundary (RR-02): the boundary is the
 * token scope, its 30-day lifetime and revocation (docs/ops/rotacja-sekretow.md).
 */
export const GH_TOKEN_DENY = Object.freeze([
  'Bash(*gh* auth token*)',
  'Bash(*gh* auth status *-t*)',
  'Bash(*gh* auth git-credential*)',
  'PowerShell(*gh* auth token*)',
  'PowerShell(*gh* auth status *-t*)',
  'PowerShell(*gh* auth git-credential*)',
]);

/** `deny` rules of .claude/settings.json: no other Docker verbs (A6), no skipped hooks, no push to main, no SSH keys, no gh token. */
export const REQUIRED_DENY = Object.freeze([
  'Bash(docker run:*)',
  'Bash(docker exec:*)',
  'Bash(docker cp:*)',
  // EVM-077: the development file is driven by tools/dev-env only (four exact forms); an agent never runs or execs in it.
  'Bash(docker compose -f compose.dev.yaml run:*)',
  'Bash(docker compose -f compose.dev.yaml exec:*)',
  'Bash(git commit --no-verify:*)',
  'Bash(git commit -n:*)',
  'Bash(git push --no-verify:*)',
  'Bash(git push --force:*)',
  'Bash(git push -f:*)',
  'Bash(git push origin main:*)',
  'Read(~/.ssh/**)',
  ...GH_TOKEN_DENY,
]);

/**
 * Agent permissions (D4, RR-03, A6; security-engineer review of EVM-006): the required `ask` and `deny` rules are present,
 * and no `allow` rule writes settings or compose files or starts Docker other than as a compose.yaml service.
 */
export function agentPermissionProblems(document: unknown, services: readonly string[]): string[] {
  const permissions = record(record(document)['permissions']);
  const rules = (kind: string): string[] => list(permissions[kind]).map(String);
  const problems = [
    ...[...REQUIRED_ASK, ...REQUIRED_ASK_COMMANDS]
      .filter((rule) => !rules('ask').includes(rule))
      .map((rule) => `.claude/settings.json: brak reguły ask ${rule}`),
    ...REQUIRED_DENY.filter((rule) => !rules('deny').includes(rule)).map((rule) => `.claude/settings.json: brak reguły deny ${rule}`),
  ];
  if (text(permissions['defaultMode']) === 'bypassPermissions') problems.push('.claude/settings.json: defaultMode bypassPermissions');
  for (const rule of rules('allow')) {
    if (/^(Edit|Write)\(/.test(rule) && /compose|settings/.test(rule)) problems.push(`.claude/settings.json: allow ${rule} omija monit`);
    if (/compose\.dev\.yaml|dev-env|pnpm (run )?dev/.test(rule))
      problems.push(`.claude/settings.json: allow ${rule} — środowisko lokalne uruchamia wyłącznie użytkownik (EVM-077)`);
    const command = /^Bash\((.*)\)$/.exec(rule)?.[1] ?? '';
    if (!/\bdocker\b/.test(command)) continue;
    const service = /^docker compose -f compose\.yaml run --rm (\S+)(?: .*)?$/.exec(command)?.[1] ?? '';
    if (!services.includes(service)) problems.push(`.claude/settings.json: allow ${rule} — Docker wyłącznie jako usługa compose.yaml`);
  }
  return problems;
}
