/**
 * The policy checkers detect violations (synthetic inputs) — proof that a green real-repository test is meaningful.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { composeProblems, dockerfileProblems } from '../src/compose.ts';
import {
  annotatedIgnoreProblems,
  expiryProblems,
  gitleaksIgnoreProblems,
  osvExceptionProblems,
  trivyExceptionProblems,
} from '../src/exceptions.ts';
import { daysBetween, staged, today, yaml } from '../src/files.ts';
import { envExampleProblems, gitleaksConfigProblems } from '../src/secrets.ts';
import {
  agentPermissionProblems,
  ciGateProblems,
  ciRoutingProblems,
  ciTriggerProblems,
  DOCS_CHECK_SCRIPT,
  docsCheckStepProblems,
  dockerCommandProblems,
  GATE_JQ,
  GH_TOKEN_DENY,
  renovateWorkflowProblems,
  REQUIRED_ASK,
  REQUIRED_ASK_COMMANDS,
  REQUIRED_DENY,
  workflowProblems,
} from '../src/workflows.ts';

const DIGEST = 'a'.repeat(64);
const SHA = 'b'.repeat(40);
const TODAY = '2026-10-03';
const HARDENED = { read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], user: '65534:65534' };
const dockerfile = (): string => `FROM node:26@sha256:${DIGEST}\nUSER node\n`;

describe('compose.yaml checker (EVM-006 AC1; A6, W9)', () => {
  it('EVM-006 AC1: a hardened service with a pinned image passes', () => {
    const document = {
      services: {
        scan: { ...HARDENED, image: `img:1.0@sha256:${DIGEST}`, volumes: ['./src:/src:ro', './.scratch/scans:/out', 'bt-work:/work'] },
      },
    };
    expect(composeProblems(document, 'services: {}', dockerfile)).toEqual([]);
  });

  it('EVM-006 AC1 (A6): every forbidden option and missing hardening is reported', () => {
    const document = {
      name: 'fixed',
      include: ['x.yaml'],
      services: {
        bad: {
          image: 'img:latest',
          privileged: true,
          cap_add: ['NET_ADMIN'],
          devices: ['/dev/kvm'],
          env_file: '.env',
          network_mode: 'host',
          pid: 'host',
          security_opt: ['seccomp:unconfined'],
          user: 'root',
          ports: ['5432:5432', '127.0.0.1:8080:8080'],
          volumes: ['/var/run/docker.sock:/var/run/docker.sock', './src:/src', '/etc:/etc:ro'],
        },
      },
    };
    const problems = composeProblems(document, 'image: ${TAG}', dockerfile);
    for (const fragment of [
      'interpolacja',
      'bez `name:`',
      'zabronione include',
      'tag i digest',
      'zabronione privileged',
      'zabronione cap_add',
      'zabronione devices',
      'zabronione env_file',
      'network_mode: host',
      'pid: host',
      'unconfined',
      'no-new-privileges',
      'read_only',
      'cap_drop',
      'inny niż root',
      'port 5432:5432',
      'gniazdo Dockera',
      './src:/src musi być tylko do odczytu',
      'spoza listy dozwolonych',
    ]) {
      expect(problems.join('\n')).toContain(fragment);
    }
    expect(problems.join('\n')).not.toContain('127.0.0.1:8080');
  });

  it('EVM-008 AC1 (A1, RR-03): every network is internal, services join only defined networks and never publish ports there', () => {
    const service = { ...HARDENED, image: `img:1.0@sha256:${DIGEST}` };
    const good = {
      networks: { db: { internal: true } },
      services: { postgres: { ...service, networks: ['db'] }, 'backend-tests': { ...service, networks: ['db'] } },
    };
    expect(composeProblems(good, '', dockerfile)).toEqual([]);
    const bad = {
      networks: { open: {}, half: { internal: 'true' } },
      services: {
        a: { ...service, networks: ['open', 'missing'], ports: ['127.0.0.1:5432:5432'] },
        b: { ...service, networks: { half: {} } },
      },
    };
    const problems = composeProblems(bad, '', dockerfile).join('\n');
    for (const fragment of [
      'sieć open musi mieć internal: true',
      'sieć half musi mieć internal: true',
      'a: sieć missing nie jest zdefiniowana',
      'a: usługa w sieci wewnętrznej nie publikuje portów',
    ])
      expect(problems).toContain(fragment);
  });

  it('EVM-008 AC1 (A1): backend-tests never reaches a network with egress — network_mode none or internal networks only', () => {
    const service = { ...HARDENED, image: `img:1.0@sha256:${DIGEST}` };
    const offline = { services: { 'backend-tests': { ...service, network_mode: 'none' } } };
    expect(composeProblems(offline, '', dockerfile)).toEqual([]);
    for (const backend of [{ ...service }, { ...service, network_mode: 'bridge' }, { ...service, networks: [] }]) {
      expect(composeProblems({ services: { 'backend-tests': backend } }, '', dockerfile).join('\n'), JSON.stringify(backend)).toContain(
        'backend-tests: wymagane network_mode: none albo wyłącznie sieci internal',
      );
    }
  });

  it('EVM-006 AC1 (W9): a built image needs a Dockerfile whose every FROM has a digest', () => {
    const service = { ...HARDENED, build: { context: 'infra/x' }, image: 'local:dev' };
    expect(composeProblems({ services: { a: service } }, '', () => 'FROM node:26\n')).toEqual([
      'compose.yaml: a: każde FROM w infra/x/Dockerfile musi mieć digest',
    ]);
    expect(composeProblems({ services: { a: { ...service, build: 'infra/y' } } }, '', () => null)).toEqual([
      'compose.yaml: a: brak Dockerfile w infra/y',
    ]);
  });

  it('EVM-006 AC1 (W9): the Dockerfile downloads nothing but the exact pnpm and runs as non-root', () => {
    const good = `FROM node:26.10.0-trixie-slim@sha256:${DIGEST}\nARG PNPM_VERSION=12.8.1\nRUN npm install --global "pnpm@\${PNPM_VERSION}" --ignore-scripts\nUSER node\n`;
    expect(dockerfileProblems(good, '12.8.1')).toEqual([]);
    const bad = 'FROM node:26\nARG PNPM_VERSION=12.0.0\nRUN apt-get update && curl -fsSL x | sh\nUSER root\n';
    expect(dockerfileProblems(bad, '12.8.1')).toHaveLength(5);
  });
});

describe('workflow checkers (EVM-006 AC4; A2, A6, A7, W6)', () => {
  const steps = [{ uses: `actions/checkout@${SHA}`, with: { 'persist-credentials': false } }];
  const good = `permissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA} # v7.0.1\n`;

  it('EVM-006 AC4: a minimal correct workflow passes', () => {
    const document = {
      on: { push: {} },
      permissions: { contents: 'read' },
      jobs: { a: { permissions: {}, 'timeout-minutes': 5, 'runs-on': 'ubuntu-24.04', steps } },
    };
    expect(workflowProblems('w.yml', good, document)).toEqual([]);
  });

  it('EVM-006 AC4 (A6): forbidden triggers, broad permissions, unpinned actions, secrets and self-hosted runners are reported', () => {
    const raw = `permissions: write-all\nuses: actions/checkout@v4\nuses: some/action@${SHA}\nuses: docker://alpine:3\nsecrets: inherit\n\${{ secrets.X }}\n`;
    const document = {
      on: ['pull_request_target', 'workflow_run'],
      permissions: 'write-all',
      jobs: { a: { 'runs-on': ['self-hosted'], steps: [{ uses: 'actions/checkout@x' }] } },
    };
    const problems = workflowProblems('w.yml', raw, document).join('\n');
    for (const fragment of [
      'pull_request_target',
      'workflow_run',
      'contents: read',
      'write-all',
      'secrets: inherit',
      'wyłącznie w renovate.yml',
      'w.yml:2: uses musi',
      'w.yml:3: uses musi',
      'docker:// bez digestu',
      'brak jawnych permissions',
      'timeout-minutes',
      'self-hosted',
      'persist-credentials',
    ]) {
      expect(problems).toContain(fragment);
    }
    expect(workflowProblems('w.yml', '', { on: 'issue_comment' }).join('\n')).toContain('issue_comment');
  });

  interface CiJob {
    if?: string;
    needs?: string[];
    'continue-on-error'?: boolean;
    steps: Array<{ run?: string }>;
  }
  interface Doc {
    on: Record<string, Record<string, unknown>>;
    jobs: Record<string, CiJob>;
  }
  const real = (): Doc => structuredClone(yaml('.github/workflows/ci.yml')) as Doc;
  const trigger = (workflow: Doc, name: string): Record<string, unknown> => {
    const found = workflow.on[name];
    if (!found) throw new Error(`no trigger ${name}`);
    return found;
  };
  const ciJob = (workflow: Doc, name: string): CiJob => {
    const found = workflow.jobs[name];
    if (!found) throw new Error(`no job ${name}`);
    return found;
  };

  it('EVM-006 AC4 (A2, W6), EVM-083 AC3: ci-gate must need every job of the full run, run only there and evaluate the results itself; K6 is not a job of ci.yml', () => {
    expect(ciGateProblems(real())).toEqual([]);
    const broken = real();
    broken.jobs['ci-gate'] = { needs: ['quality'], steps: [{ run: 'true' }] };
    expect(ciGateProblems(broken)).toEqual([
      'ci-gate: needs musi obejmować backend, backend-integration, changes, coverage, e2e-web, quality, security',
      "ci-gate: wymagane if: always() && (github.event_name != 'push' || github.ref == 'refs/heads/main')",
      'ci-gate: skrypt musi sprawdzać dokładną listę jobów z needs',
      'ci-gate: skrypt musi zawierać GATE_JQ (success wszystkich jobów; pominięcie ciężkich tylko przy heavy=false)',
    ]);
    const weakened = real();
    ciJob(weakened, 'ci-gate').steps[0] = { run: `jq -e 'all(.[]; .result == "success" or .result == "skipped")'` };
    expect(ciGateProblems(weakened)).toContain('ci-gate: skrypt musi sprawdzać dokładną listę jobów z needs');
    const integrity = real();
    integrity.jobs['main-integrity'] = { steps: [] };
    expect(ciGateProblems(integrity)).toContain('ci.yml: main-integrity (K6) wyłącznie w osobnym workflowie main-integrity.yml');
  });

  it('EVM-083 AC4: triggers must not filter by paths (paths-ignore leaves main without ci-gate) and must keep push, pull_request to main and dispatch', () => {
    expect(ciTriggerProblems(real())).toEqual([]);
    const ignored = real();
    trigger(ignored, 'push')['paths-ignore'] = ['docs/**'];
    trigger(ignored, 'pull_request')['paths'] = ['apps/**'];
    expect(ciTriggerProblems(ignored)).toEqual([
      'ci.yml: wyzwalacz push bez filtrów paths-ignore (paths-ignore zostawia main bez ci-gate)',
      'ci.yml: wyzwalacz pull_request bez filtrów paths (paths-ignore zostawia main bez ci-gate)',
    ]);
    const missing = real();
    delete missing.on['pull_request'];
    trigger(missing, 'push')['branches'] = ['main'];
    expect(ciTriggerProblems(missing)).toEqual([
      'ci.yml: brak wyzwalacza pull_request',
      'ci.yml: pull_request wyłącznie do main',
      "ci.yml: push na każdą gałąź (branches: ['**'])",
    ]);
  });

  it('EVM-083 AC1, AC2, AC4: routing mutations are reported (gate in the fast run, validator missing from quick, heavy jobs without the condition, always())', () => {
    const cases: Array<[string, (w: Doc) => void, string]> = [
      ['quick runs for main', (w) => void (ciJob(w, 'quick').if = "github.event_name == 'push'"), 'ci.yml: quick: wymagane if:'],
      ['quick without validator', (w) => void ciJob(w, 'quick').steps.splice(3, 1), 'ci.yml: quick: brak kroku walidatora dokumentacji'],
      ['quick with needs', (w) => void (ciJob(w, 'quick').needs = ['changes']), 'ci.yml: quick bez needs'],
      [
        'changes for a branch push',
        (w) => {
          delete ciJob(w, 'changes').if;
        },
        'ci.yml: changes: wymagane if:',
      ],
      [
        'changes without the tool',
        (w) => void (ciJob(w, 'changes').steps[1] = { run: 'true' }),
        'ci.yml: changes: krok node tools/ci-changes/cli.mjs',
      ],
      [
        'e2e without the condition',
        (w) => {
          delete ciJob(w, 'e2e-web').if;
        },
        "ci.yml: e2e-web: if: needs.changes.outputs.heavy == 'true'",
      ],
      [
        'quality skipped on heavy=false',
        (w) => void (ciJob(w, 'quality').if = "needs.changes.outputs.heavy == 'true'"),
        'ci.yml: quality: bez własnego if',
      ],
      ['backend without changes', (w) => void (ciJob(w, 'backend').needs = []), 'ci.yml: backend: needs musi zawierać changes'],
      ['always() outside the gate', (w) => void (ciJob(w, 'security').if = 'always()'), 'ci.yml: security: always() wyłącznie w ci-gate'],
      [
        'continue-on-error',
        (w) => void (ciJob(w, 'coverage')['continue-on-error'] = true),
        'ci.yml: coverage: zabronione continue-on-error',
      ],
    ];
    expect(ciRoutingProblems(real())).toEqual([]);
    for (const [name, mutate, fragment] of cases) {
      const workflow = real();
      mutate(workflow);
      expect(ciRoutingProblems(workflow).join('\n'), name).toContain(fragment);
    }
  });

  // EVM-083 AC3: the real jq program of ci-gate against every case (needs jq: present on GitHub runners; JQ=<path> overrides).
  const jq = process.env['JQ'] ?? 'jq';
  const hasJq = spawnSync(jq, ['--version']).status === 0;
  const need = (result: string, heavy?: string): Record<string, unknown> => ({ result, outputs: heavy === undefined ? {} : { heavy } });
  const needs = (over: Record<string, Record<string, unknown>>): string =>
    JSON.stringify({
      changes: need('success', 'true'),
      quality: need('success'),
      backend: need('success'),
      'backend-integration': need('success'),
      'e2e-web': need('success'),
      security: need('success'),
      coverage: need('success'),
      ...over,
    });
  const gate = (input: string): number | null => spawnSync(jq, ['-e', GATE_JQ], { input }).status;
  const skipped = { 'backend-integration': need('skipped'), 'e2e-web': need('skipped'), coverage: need('skipped') };

  it.skipIf(!hasJq)(
    'EVM-083 AC3: ci-gate is green for a full success and for a documentation-only change with the heavy jobs skipped',
    () => {
      expect(gate(needs({}))).toBe(0);
      expect(gate(needs({ changes: need('success', 'false'), ...skipped }))).toBe(0);
    },
  );

  it.skipIf(!hasJq)(
    'EVM-083 AC3: ci-gate is red for a failure, cancelled, a skip beside code changes, a failed or unreadable change detection and a missing job',
    () => {
      for (const job of ['quality', 'backend', 'backend-integration', 'e2e-web', 'security', 'coverage']) {
        expect(gate(needs({ [job]: need('failure') })), `${job} failure`).toBe(1);
        expect(gate(needs({ [job]: need('cancelled') })), `${job} cancelled`).toBe(1);
        expect(gate(needs({ [job]: need('skipped') })), `${job} skipped with heavy=true`).toBe(1);
      }
      for (const job of ['quality', 'backend', 'security']) {
        expect(gate(needs({ changes: need('success', 'false'), ...skipped, [job]: need('skipped') })), `${job} skipped`).toBe(1);
      }
      expect(gate(needs({ changes: need('failure') })), 'changes failure').toBe(1);
      expect(gate(needs({ changes: need('success') })), 'heavy missing').toBe(1);
      expect(gate(needs({ changes: need('success', 'maybe') })), 'heavy unreadable').toBe(1);
      expect(gate(needs({ changes: need('success', 'false') })), 'heavy=false but heavy jobs ran').toBe(1);
      expect(gate(needs({ changes: need('success', 'false'), ...skipped, 'e2e-web': need('failure') })), 'heavy=false, e2e failure').toBe(
        1,
      );
      const missing = JSON.parse(needs({})) as Record<string, unknown>;
      delete missing['e2e-web'];
      expect(gate(JSON.stringify(missing)), 'missing job').toBe(1);
    },
  );

  it('EVM-006 AC8 (A7): the Renovate token only in the Renovate step, image by digest, scripts disabled, main only', () => {
    const raw = 'x: ${{ secrets.RENOVATE_TOKEN }}\ny: ${{ secrets.OTHER }}\n';
    const document = {
      jobs: {
        r: { if: 'always()', steps: [{ uses: `renovatebot/github-action@${SHA}`, with: { 'renovate-image': 'renovate:44' }, env: {} }] },
      },
    };
    expect(renovateWorkflowProblems(raw, document)).toHaveLength(5);
    expect(renovateWorkflowProblems('', { jobs: {} })).toContain('renovate.yml: dokładnie jeden krok renovatebot/github-action');
  });

  it('EVM-006 AC4 (A6): Docker only as docker compose -f compose.yaml run --rm <known service>', () => {
    const services = ['backend-tests'];
    expect(dockerCommandProblems('s', 'docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend', services)).toEqual([]);
    for (const command of [
      'docker run --rm -v /:/host alpine',
      'docker exec x sh',
      'docker cp a b',
      'docker compose run --rm backend-tests x',
      'docker compose -f other.yaml run --rm backend-tests x',
      'docker compose -f compose.yaml run --rm evil x',
      'docker compose -f compose.yaml run backend-tests x',
    ]) {
      expect(dockerCommandProblems('s', command, services), command).toHaveLength(1);
    }
  });
});

interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  shell?: string;
  'timeout-minutes'?: number;
  if?: string;
  env?: Record<string, string>;
  'continue-on-error'?: boolean;
  'working-directory'?: string;
}

interface Job {
  permissions?: Record<string, string>;
  'continue-on-error'?: boolean;
  defaults?: unknown;
  env?: Record<string, string>;
  steps: Step[];
}

interface Workflow {
  env?: Record<string, string>;
  defaults?: unknown;
  jobs: { quality?: Job; 'ci-gate': { needs: string[] } };
}

/** A minimal ci.yml with the documentation validator step as required (EVM-013 AC3). */
function docsWorkflow(): Workflow {
  return {
    env: { TURBO_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
    jobs: {
      quality: {
        permissions: { contents: 'read' },
        steps: [
          { uses: `actions/checkout@${SHA}`, with: { 'persist-credentials': false } },
          { uses: `pnpm/action-setup@${SHA}` },
          { uses: `actions/setup-node@${SHA}`, with: { 'node-version-file': '.nvmrc', cache: 'pnpm' } },
          {
            name: 'Documentation lifecycle validator (docs:check, bramka 11)',
            shell: 'bash',
            'timeout-minutes': 2,
            run: DOCS_CHECK_SCRIPT,
          },
          { name: 'Install (frozen lockfile)', run: 'pnpm install --frozen-lockfile' },
        ],
      },
      'ci-gate': { needs: ['quality'] },
    },
  };
}

const qualityOf = (workflow: Workflow): Job => {
  if (!workflow.jobs.quality) throw new Error('no quality job');
  return workflow.jobs.quality;
};
const stepOf = (workflow: Workflow, index: number): Step => {
  const step = qualityOf(workflow).steps[index];
  if (!step) throw new Error(`no step ${String(index)}`);
  return step;
};
const docsStep = (workflow: Workflow): Step => stepOf(workflow, 3);
const replaceInRun = (workflow: Workflow, from: string, to: string): void => {
  docsStep(workflow).run = (docsStep(workflow).run ?? '').replace(from, to);
};

describe('documentation validator step checker (EVM-013 AC3; security-engineer controls 1–3, recommendations a–c)', () => {
  it('EVM-013 AC3: the required step passes', () => {
    expect(docsCheckStepProblems(docsWorkflow())).toEqual([]);
  });

  const cases: Array<[string, (workflow: Workflow) => void, string]> = [
    [
      'no quality job',
      (w) => {
        delete w.jobs.quality;
      },
      'ci.yml: brak joba quality',
    ],
    [
      'no validator step',
      (w) => {
        qualityOf(w).steps.splice(3, 1);
      },
      'ci.yml: quality: brak kroku walidatora dokumentacji',
    ],
    [
      'another step with a command first',
      (w) => {
        qualityOf(w).steps.splice(3, 0, { run: 'pnpm install --frozen-lockfile' });
      },
      'pierwszym krokiem z poleceniem',
    ],
    [
      'another action before the validator',
      (w) => {
        qualityOf(w).steps.splice(1, 0, { uses: `actions/cache@${SHA}` });
      },
      'wyłącznie actions/checkout, pnpm/action-setup i actions/setup-node',
    ],
    [
      'no setup-node before the validator',
      (w) => {
        qualityOf(w).steps.splice(2, 1);
      },
      'po actions/setup-node',
    ],
    [
      'dependencies installed by pnpm/action-setup',
      (w) => {
        stepOf(w, 1).with = { run_install: true };
      },
      'run_install',
    ],
    [
      'another command',
      (w) => {
        replaceInRun(w, 'node tools/docs-lifecycle/cli.mjs check', 'node tools/docs-lifecycle/cli.mjs cleanup-report M0');
      },
      'wyłącznie node tools/docs-lifecycle/cli.mjs check',
    ],
    [
      'another program',
      (w) => {
        replaceInRun(w, 'node tools', 'npx tsx tools');
      },
      'wyłącznie node tools/docs-lifecycle/cli.mjs check',
    ],
    [
      '--today',
      (w) => {
        replaceInRun(w, 'check --summary', 'check --today 2026-10-05 --summary');
      },
      'bez --today',
    ],
    [
      '--list',
      (w) => {
        replaceInRun(w, 'check --summary', 'check --list --summary');
      },
      'bez --list',
    ],
    [
      'if on the step',
      (w) => {
        docsStep(w).if = 'always()';
      },
      'krok walidatora dokumentacji bez if',
    ],
    [
      'continue-on-error on the step',
      (w) => {
        docsStep(w)['continue-on-error'] = true;
      },
      'krok walidatora dokumentacji bez continue-on-error',
    ],
    [
      'env on the step',
      (w) => {
        docsStep(w).env = { NODE_OPTIONS: '--require ./x.js' };
      },
      'krok walidatora dokumentacji bez env',
    ],
    [
      'another key on the step',
      (w) => {
        docsStep(w)['working-directory'] = 'docs';
      },
      'klucz spoza listy (name, shell, timeout-minutes, run): working-directory',
    ],
    [
      '|| true',
      (w) => {
        replaceInRun(w, '|| status=$?', '|| true');
      },
      'bez || true, || :, set +e i set +o errexit',
    ],
    [
      '|| :',
      (w) => {
        replaceInRun(w, '|| status=$?', '|| :');
      },
      'bez || true, || :, set +e i set +o errexit',
    ],
    [
      'set +e',
      (w) => {
        replaceInRun(w, 'status=0', 'set +e\nstatus=0');
      },
      'bez || true, || :, set +e i set +o errexit',
    ],
    [
      'set +o errexit',
      (w) => {
        replaceInRun(w, 'status=0', 'set +o errexit\nstatus=0');
      },
      'bez || true, || :, set +e i set +o errexit',
    ],
    [
      'a pipe without shell: bash',
      (w) => {
        delete docsStep(w).shell;
        docsStep(w).run = 'node tools/docs-lifecycle/cli.mjs check --summary | tee -a "$GITHUB_STEP_SUMMARY"\n';
      },
      'potok bez shell: bash',
    ],
    [
      'shell other than bash',
      (w) => {
        docsStep(w).shell = 'sh';
      },
      'wymaga shell: bash',
    ],
    [
      'no timeout-minutes',
      (w) => {
        delete docsStep(w)['timeout-minutes'];
      },
      'timeout-minutes ≤ 5',
    ],
    [
      'timeout-minutes above 5',
      (w) => {
        docsStep(w)['timeout-minutes'] = 20;
      },
      'timeout-minutes ≤ 5',
    ],
    [
      'exit code not passed (exit 0)',
      (w) => {
        replaceInRun(w, 'exit "$status"', 'exit 0');
      },
      'kod wyjścia walidatora dokumentacji',
    ],
    [
      'exit code not captured',
      (w) => {
        replaceInRun(w, ' || status=$?', '');
      },
      'kod wyjścia walidatora dokumentacji',
    ],
    [
      'no step summary',
      (w) => {
        replaceInRun(w, ' >> "$GITHUB_STEP_SUMMARY"', '');
      },
      'GITHUB_STEP_SUMMARY',
    ],
    [
      'an expression in run',
      (w) => {
        replaceInRun(w, 'status=0', 'status=0 # ${{ github.ref }}');
      },
      'bez wyrażeń ${{ }}',
    ],
    [
      'a script other than DOCS_CHECK_SCRIPT',
      (w) => {
        replaceInRun(w, 'exit "$status"', 'echo gotowe\nexit "$status"');
      },
      'różny od DOCS_CHECK_SCRIPT',
    ],
    [
      'a name without docs:check',
      (w) => {
        docsStep(w).name = 'Docs';
      },
      'nazwa kroku walidatora dokumentacji musi zawierać docs:check',
    ],
    [
      'quality with other permissions',
      (w) => {
        qualityOf(w).permissions = { contents: 'write' };
      },
      'ci.yml: quality: permissions = { contents: read }',
    ],
    [
      'checkout of another tree',
      (w) => {
        stepOf(w, 0).with = { 'persist-credentials': false, ref: 'main' };
      },
      'actions/checkout wyłącznie z with { persist-credentials: false }',
    ],
    [
      'checkout with persisted credentials',
      (w) => {
        stepOf(w, 0).with = {};
      },
      'actions/checkout wyłącznie z with { persist-credentials: false }',
    ],
    [
      'quality missing in ci-gate',
      (w) => {
        w.jobs['ci-gate'].needs = [];
      },
      'ci.yml: ci-gate: needs musi zawierać quality',
    ],
    [
      'continue-on-error on the quality job',
      (w) => {
        qualityOf(w)['continue-on-error'] = true;
      },
      'continue-on-error joba',
    ],
    [
      'defaults of the workflow',
      (w) => {
        w.defaults = { run: { 'working-directory': 'docs' } };
      },
      'ci.yml: zabronione defaults',
    ],
    [
      'defaults of the quality job',
      (w) => {
        qualityOf(w).defaults = { run: { shell: 'sh' } };
      },
      'ci.yml: quality: zabronione defaults',
    ],
    [
      'NODE_OPTIONS in the workflow env',
      (w) => {
        w.env = { ...w.env, NODE_OPTIONS: '--require ./x.js' };
      },
      'ci.yml: env workflowu: NODE_OPTIONS spoza listy dozwolonej',
    ],
    [
      'GIT_DIR in the job env',
      (w) => {
        qualityOf(w).env = { GIT_DIR: '/tmp/x' };
      },
      'ci.yml: quality: env joba: GIT_DIR spoza listy dozwolonej',
    ],
  ];

  for (const [name, weaken, message] of cases) {
    it(`EVM-013 AC3: a weakened gate is reported — ${name}`, () => {
      const workflow = docsWorkflow();
      weaken(workflow);
      expect(docsCheckStepProblems(workflow).join('\n')).toContain(message);
    });
  }
});

describe('agent permission checker (EVM-006 D4, RR-03, A6)', () => {
  const services = ['backend-tests'];
  const settings = (permissions: Record<string, unknown>): unknown => ({
    permissions: { ask: [...REQUIRED_ASK, ...REQUIRED_ASK_COMMANDS], deny: [...REQUIRED_DENY], allow: [], ...permissions },
  });

  it('EVM-006 D4 (RR-03): the required ask and deny rules with Docker allowed only as a compose.yaml service pass', () => {
    const allow = ['Bash(pnpm run gate)', 'Bash(docker compose -f compose.yaml run --rm backend-tests pnpm run test:backend:*)'];
    expect(agentPermissionProblems(settings({ allow }), services)).toEqual([]);
  });

  it('EVM-006 D4 (RR-03): a removed ask rule for compose*.yaml, a removed Docker deny and bypassing allow rules are reported', () => {
    const ask = [...REQUIRED_ASK, ...REQUIRED_ASK_COMMANDS].filter((rule) => !rule.endsWith('(**/compose*.yaml)'));
    const deny = REQUIRED_DENY.filter((rule) => rule !== 'Bash(docker run:*)');
    const allow = [
      'Write(**/compose*.yaml)',
      'Edit(.claude/settings.json)',
      'Bash(docker:*)',
      'Bash(docker compose -f compose.yaml run --rm evil sh)',
      'Bash(docker compose -f compose.yaml up)',
    ];
    const problems = agentPermissionProblems(settings({ ask, deny, allow, defaultMode: 'bypassPermissions' }), services);
    expect(problems).toEqual([
      '.claude/settings.json: brak reguły ask Edit(**/compose*.yaml)',
      '.claude/settings.json: brak reguły ask Write(**/compose*.yaml)',
      '.claude/settings.json: brak reguły deny Bash(docker run:*)',
      '.claude/settings.json: defaultMode bypassPermissions',
      '.claude/settings.json: allow Write(**/compose*.yaml) omija monit',
      '.claude/settings.json: allow Edit(.claude/settings.json) omija monit',
      '.claude/settings.json: allow Bash(docker:*) — Docker wyłącznie jako usługa compose.yaml',
      '.claude/settings.json: allow Bash(docker compose -f compose.yaml run --rm evil sh) — Docker wyłącznie jako usługa compose.yaml',
      '.claude/settings.json: allow Bash(docker compose -f compose.yaml up) — Docker wyłącznie jako usługa compose.yaml',
    ]);
    expect(agentPermissionProblems({}, services)).toHaveLength(REQUIRED_ASK.length + REQUIRED_ASK_COMMANDS.length + REQUIRED_DENY.length);
  });

  it('EVM-006 AC1 (K4, RR-02): missing deny rules against printing the gh token are reported', () => {
    const deny = REQUIRED_DENY.filter((rule) => !GH_TOKEN_DENY.includes(rule));
    expect(agentPermissionProblems(settings({ deny }), services)).toEqual([
      '.claude/settings.json: brak reguły deny Bash(*gh* auth token*)',
      '.claude/settings.json: brak reguły deny Bash(*gh* auth status *-t*)',
      '.claude/settings.json: brak reguły deny Bash(*gh* auth git-credential*)',
      '.claude/settings.json: brak reguły deny PowerShell(*gh* auth token*)',
      '.claude/settings.json: brak reguły deny PowerShell(*gh* auth status *-t*)',
      '.claude/settings.json: brak reguły deny PowerShell(*gh* auth git-credential*)',
    ]);
  });

  it('EVM-006 AC1 (K4, RR-02): the gh token rules deny gh, gh.exe and the full path in Git Bash and PowerShell (token, status -t, git-credential), not other gh commands', () => {
    // Rule matching as documented (code.claude.com/docs/en/permissions → "Wildcard patterns", "PowerShell"): `*` stands for
    // any text, including spaces, quotes and path separators; the rest is literal; PowerShell rules ignore case.
    const denies = (tool: 'Bash' | 'PowerShell', command: string): boolean =>
      GH_TOKEN_DENY.filter((rule) => rule.startsWith(`${tool}(`)).some((rule) => {
        const source = rule
          .slice(tool.length + 1, -1)
          .split('*')
          .map((part) => part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))
          .join('[\\s\\S]*');
        return new RegExp(`^${source}$`, tool === 'PowerShell' ? 'i' : '').test(command);
      });
    const bashPath = '/c/Program Files/GitHub CLI/gh.exe';
    const windowsPath = 'C:\\Program Files\\GitHub CLI\\gh.exe';
    const deniedInBash = [
      'gh auth token',
      'gh auth token --hostname github.com',
      'gh.exe auth token',
      `"${bashPath}" auth token`,
      `'${bashPath}' auth token`,
      '/c/Program\\ Files/GitHub\\ CLI/gh.exe auth token',
      `"${windowsPath}" auth token`,
      'gh auth status --show-token',
      'gh auth status -t',
      `"${bashPath}" auth status --hostname github.com -t`,
      `"${bashPath}" auth status --show-token`,
      'gh auth git-credential get',
      `"${bashPath}" auth git-credential get`,
      '/c/Program\\ Files/GitHub\\ CLI/gh.exe auth git-credential get',
    ];
    const deniedInPowerShell = [
      'gh auth token',
      'gh.exe auth status -t',
      `& "${windowsPath}" auth token`,
      `& '${windowsPath}' auth status --show-token`,
      `& "${windowsPath.toUpperCase()}" auth status -t`,
      `& "${windowsPath}" auth git-credential get`,
    ];
    const allowedInBash = [
      'gh auth status',
      `"${bashPath}" auth status`,
      `"${bashPath}" auth status --hostname github.com --active`,
      `"${bashPath}" run list --branch feature/EVM-006-domkniecie`,
      `"${bashPath}" api repos/{owner}/{repo}/actions/runs`,
      `"${bashPath}" pr view 2 --json title,state`,
    ];
    const allowedInPowerShell = [`& "${windowsPath}" auth status`, `& "${windowsPath}" run list`, `& "${windowsPath}" pr checks 2`];
    for (const command of deniedInBash) expect(denies('Bash', command), command).toBe(true);
    for (const command of deniedInPowerShell) expect(denies('PowerShell', command), command).toBe(true);
    for (const command of allowedInBash) expect(denies('Bash', command), command).toBe(false);
    for (const command of allowedInPowerShell) expect(denies('PowerShell', command), command).toBe(false);
  });

  it('EVM-006 D4: the committed content is read from the git index; outside a git checkout from the file itself', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evm-006-staged-'));
    try {
      writeFileSync(join(dir, 'settings.json'), '{"synthetic":true}');
      expect(staged('settings.json', dir)).toBe('{"synthetic":true}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('secret configuration checkers (EVM-006 AC5; A3)', () => {
  it('EVM-006 AC5: .env.example accepts comments and example values, rejects secret shapes and long random values', () => {
    expect(envExampleProblems('# comment\nDATABASE_URL=postgres://evia:example@localhost:5432/evia\nEMPTY=\n')).toEqual([]);
    const token = ['gh', 'p_', 'A'.repeat(36)].join('');
    expect(envExampleProblems(`TOKEN=${token}\nKEY=${'x'.repeat(40)}\nnot an assignment\n`)).toHaveLength(3);
  });

  it('EVM-006 AC5 (A3): .gitleaks.toml may only extend the default rules', () => {
    expect(gitleaksConfigProblems('# comment\n[extend]\nuseDefault = true\n')).toEqual([]);
    expect(gitleaksConfigProblems('[extend]\nuseDefault = true\n[allowlist]\npaths = ["docs/"]\n')).toHaveLength(1);
  });
});

describe('exception checkers (EVM-006 AC4; B2, A3, A5)', () => {
  it('EVM-006 AC4: expiry — valid, expired, too far, malformed', () => {
    expect(expiryProblems('x', '2026-10-20', TODAY, 30)).toEqual([]);
    expect(expiryProblems('x', '2026-10-02', TODAY, 30)[0]).toContain('wygasł');
    expect(expiryProblems('x', '2026-11-10', TODAY, 30)[0]).toContain('dalej niż 30 dni');
    expect(expiryProblems('x', '2026-02-30', TODAY, 30)[0]).toContain('daty');
    expect(expiryProblems('x', '', TODAY, 30)[0]).toContain('daty');
  });

  it('EVM-006 AC4 (A5): OSV exceptions — fields, owner, story, horizons, never MAL-', () => {
    const ok = '[[IgnoredVulns]]\nid = "GHSA-x"\nignoreUntil = 2026-12-01\nreason = "not reachable · owner: devops-engineer · EVM-007"\n';
    expect(osvExceptionProblems(ok, TODAY)).toEqual([]);
    const high = '[[IgnoredVulns]]\nid = "GHSA-y"\nignoreUntil = 2026-12-01\nreason = "High, not reachable · owner: devops · EVM-007"\n';
    expect(osvExceptionProblems(high, TODAY)[0]).toContain('30 dni');
    const bad =
      '[[IgnoredVulns]]\nid = "MAL-2026-1"\nignoreUntil = 2026-10-10\nreason = "trust me"\n[[IgnoredVulns]]\nreason = "x"\n[PackageOverrides]\n';
    const problems = osvExceptionProblems(bad, TODAY).join('\n');
    for (const fragment of ['MAL-', 'owner', 'brak id', 'nieobsługiwana sekcja']) expect(problems).toContain(fragment);
  });

  it('EVM-006 AC4: Trivy exceptions need statement with owner and story and an expiry date', () => {
    const document = parse(
      'misconfigurations:\n  - id: DS-0026\n    statement: "one-off container · owner: devops · EVM-006"\n    expired_at: 2026-12-01\nvulnerabilities:\n  - id: CVE-1\n    statement: "Critical · owner: devops · EVM-007"\n    expired_at: 2026-12-01\nlicenses:\n  - id: GPL-3.0\n    statement: "x"\n',
    ) as unknown;
    const problems = trivyExceptionProblems(document, TODAY);
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toContain('vulnerabilities[0] (CVE-1): data 2026-12-01 jest dalej niż 30 dni');
  });

  it('EVM-006 AC5 (A3): .gitleaksignore — fingerprints only, each with reason, owner and review_by', () => {
    const ok = `# reason: test fixture · owner: devops · review_by: 2026-11-01\n${'c'.repeat(40)}:docs/x.md:generic-api-key:3\n`;
    expect(gitleaksIgnoreProblems(ok, TODAY)).toEqual([]);
    expect(gitleaksIgnoreProblems(`${'c'.repeat(40)}:docs/x.md:generic-api-key:3\n`, TODAY)).toHaveLength(2);
    expect(gitleaksIgnoreProblems('docs/**\n', TODAY)).toEqual([
      '.gitleaksignore: linia 1: dozwolone są wyłącznie fingerprinty gitleaks i komentarze',
    ]);
  });

  it('EVM-006 AC4: annotated ignores (zizmor, nosemgrep) need reason, owner and review_by', () => {
    const marker = /zizmor: ignore\[/;
    expect(
      annotatedIgnoreProblems('w', '# reason: x · owner: y · review_by: 2026-11-01\nrun: x # zizmor: ignore[a]\n', marker, TODAY),
    ).toEqual([]);
    expect(annotatedIgnoreProblems('w', 'run: x # zizmor: ignore[a]\n', marker, TODAY)).toHaveLength(2);
  });

  it('EVM-006 AC4: dates use the Europe/Warsaw business day', () => {
    expect(today(new Date('2026-10-03T22:30:00Z'))).toBe('2026-10-04');
    expect(daysBetween('2026-10-03', '2026-11-02')).toBe(30);
  });

  it('EVM-006 AC4 (QA): the business day and exception horizons stay right around the DST changes in Europe/Warsaw', () => {
    // Autumn 2026: CEST (UTC+2) ends on 2026-10-25 at 03:00 local time; spring 2026: CEST starts on 2026-03-29 at 02:00.
    expect(today(new Date('2026-10-24T21:59:59Z'))).toBe('2026-10-24');
    expect(today(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
    expect(today(new Date('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
    expect(today(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
    expect(today(new Date('2026-03-28T22:59:59Z'))).toBe('2026-03-28');
    expect(today(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
    expect(today(new Date('2026-03-29T21:59:59Z'))).toBe('2026-03-29');
    expect(today(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
    // A 25-hour and a 23-hour day still count as one day — horizons (≤ 30 / ≤ 90 days) do not drift.
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-03-01', '2026-05-30')).toBe(90);
  });
});
