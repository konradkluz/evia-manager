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
 * A2, W6: `ci-gate` depends on every other job except `main-integrity`, always runs and requires `success` of each
 * dependency, with the exact list of dependencies in its check (a skipped, cancelled, failed or missing job = red).
 */
export function ciGateProblems(document: unknown): string[] {
  const jobs = record(record(document)['jobs']);
  const gate = record(jobs['ci-gate']);
  const needs = list(gate['needs']).map(String).sort();
  const expected = Object.keys(jobs)
    .filter((name) => name !== 'ci-gate' && name !== 'main-integrity')
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
  for (const [name, value] of Object.entries(jobs)) {
    if (list(record(value)['needs']).map(String).includes('main-integrity'))
      problems.push(`ci-gate: ${name} nie może zależeć od main-integrity`);
  }
  return problems;
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
