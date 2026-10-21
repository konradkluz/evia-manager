/**
 * Entry point of the verifier container (EVM-007 AC3, AC4; ADR-0018; architect 12, 13; security-engineer B).
 * One cycle per systemd tick: read the configuration, the registry (read-only) and the token, verify, write the result
 * atomically for deploy.sh, write the heartbeat state and metrics into its own state directory, log one line without
 * personal data or secrets. Exit code 0 = a decision to act on (deploy, rollback, none); 3 = reject (systemd marks the
 * unit failed: OnFailure= raises the local alert and deploy.sh does not run); 2 = an unsafe environment.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseConfig, type AgentConfig } from './config.ts';
import { Rejection, SHA } from './errors.ts';
import { GitHub, PRODUCTION_API } from './github.ts';
import { parseRegistry, type RegistryEntry } from './registry.ts';
import { verify, type Decision } from './verify.ts';

export interface Paths {
  readonly config: string;
  readonly registry: string;
  readonly token: string;
  readonly rollback: string;
  readonly result: string;
  readonly state: string;
}

/** The mounts of the verifier container (infra/deploy-agent/compose.agent.yaml). */
export const CONTAINER_PATHS: Paths = {
  config: '/etc/evia-agent/config.json',
  registry: '/var/lib/evia/deploy/registry.json',
  token: '/run/secrets/github-pat',
  rollback: '/etc/evia-agent/rollback',
  result: '/out/result.json',
  state: '/state',
};

/** Variables that would weaken TLS or route the token through a proxy — the verifier refuses to start. */
export const UNSAFE_ENV = [
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_EXTRA_CA_CERTS',
  'NODE_USE_ENV_PROXY',
  'NODE_OPTIONS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
];

const BACKOFF_MS = 15 * 60 * 1000;

export interface RunOptions {
  readonly paths: Paths;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: Date;
  /** Tests only: the base URL of the stub API (production: https://api.github.com, fixed). */
  readonly apiBase?: string;
  readonly allowHttpArtifactHost?: boolean;
}

export interface RunResult {
  readonly exitCode: 0 | 2 | 3;
  readonly decision: Decision;
  readonly requests: number;
}

/** Atomic write: a temporary file in the same directory and a rename. */
export function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, path);
}

const readOptional = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);

/** The administrator's rollback command: a file with one full commit SHA (written by root on the VM). */
export function readRollback(text: string | null): string | null {
  if (text === null) return null;
  const commit = text.trim();
  if (!SHA.test(commit)) throw new Rejection('rollback-command', 'not a full commit SHA');
  return commit;
}

interface State {
  readonly notBefore: string | null;
  readonly lastSuccess: string | null;
}

function readState(path: string): State {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return {
      notBefore: typeof value['notBefore'] === 'string' ? value['notBefore'] : null,
      lastSuccess: typeof value['lastSuccess'] === 'string' ? value['lastSuccess'] : null,
    };
  } catch {
    return { notBefore: null, lastSuccess: null };
  }
}

/** Prometheus text metrics for the node exporter textfile collector (Alloy, EVM-085) — no personal data. */
export function metrics(
  decision: Decision,
  now: Date,
  lastSuccess: string | null,
  deployed: RegistryEntry | undefined,
  requests: number,
): string {
  const seconds = (iso: string | null): string => (iso === null ? '0' : String(Math.floor(Date.parse(iso) / 1000)));
  const lines = [
    '# HELP deploy_agent_last_run_timestamp_seconds Last verification cycle.',
    '# TYPE deploy_agent_last_run_timestamp_seconds gauge',
    `deploy_agent_last_run_timestamp_seconds ${seconds(now.toISOString())}`,
    '# HELP deploy_agent_last_success_timestamp_seconds Last cycle that did not reject.',
    '# TYPE deploy_agent_last_success_timestamp_seconds gauge',
    `deploy_agent_last_success_timestamp_seconds ${seconds(lastSuccess)}`,
    '# HELP deploy_agent_last_decision Decision of the last cycle.',
    '# TYPE deploy_agent_last_decision gauge',
    ...['deploy', 'rollback', 'none', 'reject'].map(
      (name) => `deploy_agent_last_decision{decision="${name}"} ${decision.decision === name ? '1' : '0'}`,
    ),
    '# HELP deploy_agent_api_requests GitHub API requests of the last cycle.',
    '# TYPE deploy_agent_api_requests gauge',
    `deploy_agent_api_requests ${String(requests)}`,
  ];
  if (deployed !== undefined)
    lines.push(
      '# HELP deployed_commit_info The deployed commit and manifest.',
      '# TYPE deployed_commit_info gauge',
      `deployed_commit_info{commit="${deployed.commit}",manifest_sha256="${deployed.manifestSha256}"} 1`,
    );
  return `${lines.join('\n')}\n`;
}

async function decide(options: RunOptions, config: AgentConfig, registry: RegistryEntry[], github: GitHub): Promise<Decision> {
  const rollbackTo = readRollback(readOptional(options.paths.rollback));
  return verify({ github, config, registry, rollbackTo });
}

/** One cycle with the given paths and environment. */
export async function run(options: RunOptions): Promise<RunResult> {
  const { paths, env, now } = options;
  const statePath = join(paths.state, 'state.json');
  const state = readState(statePath);
  let requests = 0;
  let decision: Decision;
  let exitCode: 0 | 2 | 3 = 0;
  let registry: RegistryEntry[] = [];
  const unsafe = UNSAFE_ENV.filter((name) => env[name] !== undefined && env[name] !== '');
  if (unsafe.length > 0) {
    decision = { decision: 'reject', head: null, reasons: [`unsafe-environment: ${unsafe.join(', ')}`] };
    exitCode = 2;
  } else if (state.notBefore !== null && Date.parse(state.notBefore) > now.getTime()) {
    decision = { decision: 'none', head: null, reasons: ['rate limit backoff — no request this cycle'] };
  } else {
    try {
      const config = parseConfig(readFileSync(paths.config, 'utf8'));
      registry = parseRegistry(readOptional(paths.registry));
      const token = readFileSync(paths.token, 'utf8').trim();
      if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new Rejection('token', 'unreadable token file');
      const github = new GitHub({
        baseUrl: options.apiBase ?? PRODUCTION_API,
        token,
        owner: config.repository.owner,
        repo: config.repository.name,
        budget: config.requestBudget,
        artifactHosts: config.artifactHosts,
        allowHttpArtifactHost: options.allowHttpArtifactHost === true,
      });
      decision = await decide(options, config, registry, github);
      requests = github.requests;
    } catch (error) {
      decision = { decision: 'reject', head: null, reasons: [error instanceof Rejection ? error.message : 'internal-error'] };
    }
    if (decision.decision === 'reject') exitCode = 3;
  }
  const limited = decision.decision === 'reject' && decision.reasons.some((reason) => reason.startsWith('api-rate-limit'));
  const lastSuccess = decision.decision === 'reject' ? state.lastSuccess : now.toISOString();
  const notBefore = limited ? new Date(now.getTime() + BACKOFF_MS).toISOString() : null;
  writeAtomic(paths.result, `${JSON.stringify({ schemaVersion: 1, checkedAt: now.toISOString(), ...decision })}\n`);
  writeAtomic(statePath, `${JSON.stringify({ lastRun: now.toISOString(), lastSuccess, notBefore, lastDecision: decision.decision })}\n`);
  writeAtomic(join(paths.state, 'metrics.prom'), metrics(decision, now, lastSuccess, registry.at(-1), requests));
  return { exitCode, decision, requests };
}

/** One log line: identifiers and reasons only (SR-LOG-02). */
export function logLine(result: RunResult): string {
  const decision = result.decision;
  return JSON.stringify({
    decision: decision.decision,
    commit: 'commit' in decision ? decision.commit : null,
    head: decision.head,
    reasons: decision.reasons,
    requests: result.requests,
  });
}

/* v8 ignore start -- process wiring of the container (run() and logLine() are tested; the container in the IaC session) */
if (import.meta.main) {
  const result = await run({ paths: CONTAINER_PATHS, env: process.env, now: new Date() });
  console.log(logLine(result));
  process.exitCode = result.exitCode;
}
/* v8 ignore stop */
