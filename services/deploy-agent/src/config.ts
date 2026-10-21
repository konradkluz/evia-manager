/**
 * Configuration of the VM (EVM-007 AC3; ADR-0018; architect 4–7, security-engineer B "Granica zaufania"). Owned by root,
 * mounted read-only into the verifier, changed only in an IaC session of Konrad. Strict: an unknown or missing key, a
 * wrong type or a value outside its pattern stops the verifier (no default for any security-relevant value).
 */
import { Rejection, SHA, ensure, integer, record, string } from './errors.ts';

export interface Baseline {
  /** The commit of `main` trusted when the channel starts (or after an incident, moved in an IaC session). */
  readonly commit: string;
  /** ID of the Activity event that set `main` to this commit — V0 is anchored to it, never to a time. */
  readonly activityEventId: number;
}

export interface AgentConfig {
  readonly repository: { readonly owner: string; readonly name: string };
  /** Numeric ID of Konrad's GitHub account (never the login). */
  readonly ownerAccountId: number;
  /** Numeric ID of the ci.yml workflow (never its name). */
  readonly workflowId: number;
  readonly baseline: Baseline;
  /** The compose file of the channel — the manifest must name exactly this path (architect 7). */
  readonly composePath: string;
  /** Allowed GHCR repositories of the release images, by logical name. */
  readonly imageRepositories: { readonly api: string; readonly web: string };
  /** Hosts an artifact download may be redirected to (exact host or a `.suffix`); the token never goes there. */
  readonly artifactHosts: readonly string[];
  /** The most API requests one cycle may make (the 5000/h limit is shared with production and the orchestrator). */
  readonly requestBudget: number;
  /** The external Docker network shared with the edge Caddy and PostgreSQL (infra/runtime/compose.infra.yaml). */
  readonly runtimeNetwork: string;
  /** The most commits between the deployed commit and HEAD the verifier accepts in one cycle. */
  readonly maxRangeCommits: number;
}

const KEYS = [
  'repository',
  'ownerAccountId',
  'workflowId',
  'baseline',
  'composePath',
  'imageRepositories',
  'artifactHosts',
  'requestBudget',
  'runtimeNetwork',
  'maxRangeCommits',
];
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const HOST = /^\.?[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const REPOSITORY = /^ghcr\.io\/[a-z0-9_.-]+\/evia-(api|web)$/;

function exactKeys(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  const actual = Object.keys(value).sort();
  ensure(JSON.stringify(actual) === JSON.stringify([...keys].sort()), 'config', `${where}: keys must be exactly ${keys.join(', ')}`);
}

/** Parses and validates the configuration file (JSON text). */
export function parseConfig(text: string): AgentConfig {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Rejection('config', 'not valid JSON');
  }
  const top = record(document, 'config');
  exactKeys(top, KEYS, 'config');
  const repository = record(top['repository'], 'config');
  exactKeys(repository, ['owner', 'name'], 'repository');
  const owner = string(repository['owner'], 'config');
  const name = string(repository['name'], 'config');
  ensure(NAME.test(owner) && NAME.test(name), 'config', 'repository owner and name');
  const baseline = record(top['baseline'], 'config');
  exactKeys(baseline, ['commit', 'activityEventId'], 'baseline');
  const commit = string(baseline['commit'], 'config');
  ensure(SHA.test(commit), 'config', 'baseline.commit must be a full SHA');
  const composePath = string(top['composePath'], 'config');
  ensure(/^infra\/runtime\/[a-z0-9.-]+\.yaml$/.test(composePath), 'config', 'composePath');
  const images = record(top['imageRepositories'], 'config');
  exactKeys(images, ['api', 'web'], 'imageRepositories');
  const api = string(images['api'], 'config');
  const web = string(images['web'], 'config');
  ensure(
    REPOSITORY.test(api) && api.endsWith('/evia-api') && REPOSITORY.test(web) && web.endsWith('/evia-web'),
    'config',
    'imageRepositories',
  );
  const hosts = top['artifactHosts'];
  ensure(Array.isArray(hosts) && hosts.length > 0, 'config', 'artifactHosts must be a non-empty list');
  const artifactHosts = hosts.map((host) => string(host, 'config'));
  ensure(
    artifactHosts.every((host) => HOST.test(host) && host !== 'api.github.com'),
    'config',
    'artifactHosts: host names only, never api.github.com',
  );
  const runtimeNetwork = string(top['runtimeNetwork'], 'config');
  ensure(/^[a-z][a-z0-9-]{1,40}$/.test(runtimeNetwork), 'config', 'runtimeNetwork');
  const config: AgentConfig = {
    repository: { owner, name },
    ownerAccountId: integer(top['ownerAccountId'], 'config'),
    workflowId: integer(top['workflowId'], 'config'),
    baseline: { commit, activityEventId: integer(baseline['activityEventId'], 'config') },
    composePath,
    imageRepositories: { api, web },
    artifactHosts,
    requestBudget: integer(top['requestBudget'], 'config'),
    runtimeNetwork,
    maxRangeCommits: integer(top['maxRangeCommits'], 'config'),
  };
  ensure(config.ownerAccountId > 0 && config.workflowId > 0 && config.baseline.activityEventId > 0, 'config', 'IDs must be positive');
  ensure(config.requestBudget >= 10 && config.requestBudget <= 1000, 'config', 'requestBudget within 10–1000');
  ensure(config.maxRangeCommits >= 1 && config.maxRangeCommits <= 500, 'config', 'maxRangeCommits within 1–500');
  return config;
}

/** True when the host is allowed by the list (exact host, or a `.suffix` matching a subdomain). */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => (entry.startsWith('.') ? host.endsWith(entry) && host.length > entry.length : host === entry));
}
